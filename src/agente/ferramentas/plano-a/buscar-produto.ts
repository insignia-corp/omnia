import { and, desc, eq, sql } from "drizzle-orm";
import { LIMITE_SIMILARIDADE_PADRAO } from "../../../config/env";
import type { Db } from "../../../infra/database/database.module";
import { vinculoDescricaoProduto } from "../../../infra/database/schema";
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

/**
 * Produtos que a descrição confirmada pelo dono identifica quando não se sabe o fornecedor. A mesma
 * descrição pode ser produtos diferentes em fornecedores diferentes (o vínculo guarda o fornecedor), e a
 * correção do dono entra como linha nova: vale o vínculo mais recente de cada fornecedor. Linhas gravadas
 * juntas (mesmo `criado_em`) empatam e todas valem: dois produtos com o mesmo apelido são pergunta, não escolha.
 */
async function produtosDaDescricaoConfirmada(
  db: Db,
  comercianteId: string,
  descricaoNormalizada: string,
): Promise<string[]> {
  const linhas = await db
    .select({
      produtoId: vinculoDescricaoProduto.produtoId,
      fornecedorId: vinculoDescricaoProduto.fornecedorId,
      // Texto, não Date: o driver corta os microssegundos e dois vínculos próximos pareceriam gravados juntos.
      criadoEm: sql<string>`${vinculoDescricaoProduto.criadoEm}::text`,
    })
    .from(vinculoDescricaoProduto)
    .where(
      and(
        eq(vinculoDescricaoProduto.comercianteId, comercianteId),
        eq(vinculoDescricaoProduto.descricaoNormalizada, descricaoNormalizada),
        eq(vinculoDescricaoProduto.confirmadoPeloDono, true),
      ),
    )
    .orderBy(desc(vinculoDescricaoProduto.criadoEm));
  const atualPorFornecedor = new Map<string | null, { criadoEm: string; produtos: Set<string> }>();
  for (const l of linhas) {
    const atual = atualPorFornecedor.get(l.fornecedorId);
    if (!atual)
      atualPorFornecedor.set(l.fornecedorId, { criadoEm: l.criadoEm, produtos: new Set([l.produtoId]) });
    else if (atual.criadoEm === l.criadoEm) atual.produtos.add(l.produtoId);
  }
  return [...new Set([...atualPorFornecedor.values()].flatMap((g) => [...g.produtos]))];
}

/** Candidatos de uma lista de ids achados por uma descrição confirmada, com os campos que o dono vê para distinguir nomes iguais. */
async function candidatosPorId(
  db: Db,
  comercianteId: string,
  produtoIds: string[],
  descricaoDeNota: string,
): Promise<CandidatoDaBusca[]> {
  const resultado = await db.execute<{
    produto_id: string;
    nome: string;
    codigo_barras: string | null;
    sku: string | null;
    cadastrado_em: string;
  }>(sql`
    select p.id as produto_id, p.nome, p.codigo_barras, p.sku,
           (p.criado_em at time zone ${FUSO})::date::text as cadastrado_em
      from produto p
     where p.comerciante_id = ${comercianteId}
       and p.id in (${sql.join(
         produtoIds.map((id) => sql`${id}`),
         sql`, `,
       )})
     order by p.nome, p.id
  `);
  return resultado.rows.map((l) => ({
    produtoId: l.produto_id,
    nome: l.nome,
    codigoBarras: l.codigo_barras,
    sku: l.sku,
    cadastradoEm: l.cadastrado_em,
    descricaoDeNota,
    similaridade: 1,
  }));
}

type LinhaDaBusca = {
  produto_id: string;
  nome: string;
  codigo_barras: string | null;
  sku: string | null;
  cadastrado_em: string;
  /** A descrição que dá a melhor similaridade do nome inteiro, e a que dá a melhor `word_similarity`. Nula quando o nome vence ou empata. */
  descricao_por_sim: string | null;
  descricao_por_palavra: string | null;
  sim: number;
  palavra: number;
};

/**
 * Procura um produto do comerciante pelo nome aproximado (`pg_trgm`), com o mesmo critério do
 * vínculo de notas: só escolhe sozinho se for claramente o melhor, senão devolve sugestões.
 * Compara também com as descrições que o dono já confirmou nas notas, e uma descrição confirmada
 * igual à digitada liga sozinha, como no vínculo de notas. Se ela aponta para produtos diferentes em
 * fornecedores diferentes, os produtos voltam como candidatos: sem o fornecedor, ninguém escolhe pelo dono.
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
  const confirmados = await produtosDaDescricaoConfirmada(db, comercianteId, consulta);
  if (confirmados.length === 1) {
    const produto = await buscarProdutoPorId(db, comercianteId, confirmados[0]!);
    if (produto) return { tipo: "vinculado", produtoId: produto.produtoId, nome: produto.nome, confianca: 1 };
  }
  if (confirmados.length > 1) {
    return { tipo: "sugestao", candidatos: await candidatosPorId(db, comercianteId, confirmados, consulta) };
  }
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
         and v.criado_em = (
           select max(x.criado_em)
             from vinculo_descricao_produto x
            where x.comerciante_id = v.comerciante_id and x.confirmado_pelo_dono
              and x.fornecedor_id is not distinct from v.fornecedor_id
              and x.descricao_normalizada = v.descricao_normalizada
         )
    ), melhor as (
      select produto_id,
             max(sim) as sim,
             max(palavra) as palavra,
             (array_agg(descricao_de_nota order by sim desc, descricao_de_nota nulls first))[1]
               as descricao_por_sim,
             (array_agg(descricao_de_nota order by palavra desc, descricao_de_nota nulls first))[1]
               as descricao_por_palavra
        from fonte
       group by produto_id
    )
    select m.produto_id, p.nome, p.codigo_barras, p.sku,
           (p.criado_em at time zone ${FUSO})::date::text as cadastrado_em,
           m.descricao_por_sim, m.descricao_por_palavra, m.sim::float8 as sim, m.palavra::float8 as palavra
      from melhor m
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
      // O mesmo critério da similaridade exibida e da decisão: a descrição mostrada é a que a justifica.
      descricaoDeNota: pelaPalavra ? l.descricao_por_palavra : l.descricao_por_sim,
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
