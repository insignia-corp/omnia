import { sql } from "drizzle-orm";
import { LIMITE_SIMILARIDADE_PADRAO } from "../../../config/env";
import type { Db } from "../../../infra/database/database.module";
import {
  NOME_NORMALIZADO,
  decidirPorSimilaridade,
  type CandidatoProduto,
} from "../../../ingestao/vinculo/vincular-produto";
import { normalizarDescricao } from "../../../ingestao/normalizar-descricao";

/**
 * Valor padrão do limite do vínculo de nota: errar o produto muda o número que o dono recebe. A
 * variável `LIMITE_SIMILARIDADE` não é lida aqui (as ferramentas só recebem o `db`).
 */
export const SIMILARIDADE_PARA_ESCOLHER_PRODUTO = LIMITE_SIMILARIDADE_PADRAO;

/**
 * Candidato de uma busca sem escolha clara. Traz o que o dono enxerga para distinguir produtos de
 * mesmo nome: código de barras, SKU e data de cadastro; e, quando achado por uma descrição de nota
 * que ele já confirmou, essa descrição.
 */
export interface CandidatoDaBusca extends CandidatoProduto {
  codigoBarras: string | null;
  sku: string | null;
  cadastradoEm: string;
  descricaoDeNota: string | null;
}

const FUSO = sql.raw("'America/Sao_Paulo'");

/** O produto achado traz o nome do cadastro: o id e o nome vêm da mesma consulta do comerciante da sessão. */
export type ProdutoAchado =
  | { tipo: "vinculado"; produtoId: string; nome: string; confianca: number }
  | { tipo: "sugestao"; candidatos: CandidatoDaBusca[] }
  | { tipo: "sem_candidato" };

type LinhaDaBusca = {
  produto_id: string;
  nome: string;
  codigo_barras: string | null;
  sku: string | null;
  cadastrado_em: string;
  descricao_de_nota: string | null;
  sim: number;
  palavra: number;
};

/**
 * Procura um produto do comerciante pelo nome aproximado (`pg_trgm`), com o mesmo critério do
 * vínculo de notas: só escolhe sozinho se for claramente o melhor, senão devolve sugestões.
 * A nota traz a descrição inteira; o dono digita só uma palavra ("arroz"), que a similaridade pelo
 * nome todo subestima. Quando nenhum nome chega ao limite pela similaridade do nome todo, vale a
 * `word_similarity` (a palavra dentro do nome). Se algum chega, a similaridade do nome todo decide
 * como antes, para "refrigerante cola 2 l" preferir a de 2L à de lata. Uma palavra comum a vários
 * produtos ("refrigerante") empata em 1 e continua sugestão: a folga sobre o segundo é a mesma regra.
 */
export async function buscarProdutoPorNome(
  db: Db,
  comercianteId: string,
  nome: string,
): Promise<ProdutoAchado> {
  const consulta = normalizarDescricao(nome);
  // O universo é o nome do cadastro e as descrições de nota que o dono já confirmou para o produto
  // (o mesmo que o vínculo de notas consulta); vale o melhor dos dois para cada produto.
  const resultado = await db.execute<LinhaDaBusca>(sql`
    with fonte as (
      select p.id as produto_id, null::text as descricao_de_nota,
             similarity(${NOME_NORMALIZADO}, ${consulta}) as sim,
             word_similarity(${consulta}, ${NOME_NORMALIZADO}) as palavra
        from produto p
       where p.comerciante_id = ${comercianteId}
      union all
      select v.produto_id, v.descricao_normalizada,
             similarity(v.descricao_normalizada, ${consulta}),
             word_similarity(${consulta}, v.descricao_normalizada)
        from vinculo_descricao_produto v
       where v.comerciante_id = ${comercianteId} and v.confirmado_pelo_dono
    ), melhor as (
      -- O melhor valor de cada medida por produto (o nome e cada apelido contam); a descrição de nota só
      -- aparece quando um apelido supera o nome, e no empate vale o nome.
      select produto_id,
             max(sim) as sim,
             max(palavra) as palavra,
             (array_agg(descricao_de_nota order by greatest(sim, palavra) desc, descricao_de_nota nulls first))[1]
               as descricao_de_nota
        from fonte
       group by produto_id
    )
    select m.produto_id, p.nome, p.codigo_barras, p.sku,
           (p.criado_em at time zone ${FUSO})::date::text as cadastrado_em,
           m.descricao_de_nota, m.sim::float8 as sim, m.palavra::float8 as palavra
      from melhor m
      -- O filtro do comerciante está aqui e em cada fonte: a chave composta do vínculo já impede
      -- apelido de outro lojista, e repetir é defesa em profundidade, não um caminho a mais.
      join produto p on p.id = m.produto_id and p.comerciante_id = ${comercianteId}
     order by greatest(m.sim, m.palavra) desc, p.nome asc, p.id asc
     limit 20
  `);
  const pelaPalavra = resultado.rows.every((l) => l.sim < SIMILARIDADE_PARA_ESCOLHER_PRODUTO);
  const candidatos: CandidatoDaBusca[] = resultado.rows
    .map((l) => ({
      produtoId: l.produto_id,
      nome: l.nome,
      similaridade: pelaPalavra ? l.palavra : l.sim,
      codigoBarras: l.codigo_barras,
      sku: l.sku,
      cadastradoEm: l.cadastrado_em,
      descricaoDeNota: l.descricao_de_nota,
    }))
    .sort((x, y) => y.similaridade - x.similaridade || x.nome.localeCompare(y.nome, "pt-BR"));
  const decisao = decidirPorSimilaridade(candidatos, SIMILARIDADE_PARA_ESCOLHER_PRODUTO);
  if (decisao.tipo === "sem_candidato") return decisao;
  if (decisao.tipo === "sugestao") {
    const porId = new Map(candidatos.map((c) => [c.produtoId, c]));
    return {
      tipo: "sugestao",
      candidatos: decisao.candidatos.flatMap((c) => porId.get(c.produtoId) ?? []),
    };
  }
  const escolhido = candidatos.find((c) => c.produtoId === decisao.produtoId);
  // A decisão só liga o primeiro da lista, que é o que veio da consulta: não há outro caminho.
  if (!escolhido) throw new Error("Produto ligado fora da lista de candidatos");
  return {
    tipo: "vinculado",
    produtoId: escolhido.produtoId,
    nome: escolhido.nome,
    confianca: decisao.confianca,
  };
}

/**
 * Confere que o id escolhido é de um produto do comerciante da sessão. O id vem do modelo, que o
 * leu de uma resposta anterior: nunca vale por si, só se o cadastro do comerciante o tem.
 */
export async function buscarProdutoPorId(
  db: Db,
  comercianteId: string,
  produtoId: string,
): Promise<{ produtoId: string; nome: string } | null> {
  const resultado = await db.execute<{ produto_id: string; nome: string }>(sql`
    select p.id as produto_id, p.nome
      from produto p
     where p.id = ${produtoId} and p.comerciante_id = ${comercianteId}
  `);
  const linha = resultado.rows[0];
  return linha ? { produtoId: linha.produto_id, nome: linha.nome } : null;
}
