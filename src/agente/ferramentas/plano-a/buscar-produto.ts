import { and, desc, eq, sql } from "drizzle-orm";
import { LIMITE_SIMILARIDADE_PADRAO } from "../../../config/env";
import type { Db } from "../../../infra/database/database.module";
import { vinculoDescricaoProduto } from "../../../infra/database/schema";
import {
  decidirPorSimilaridade,
  textosDosProdutos,
  type CandidatoProduto,
} from "../../../ingestao/vinculo/vincular-produto";
import { normalizarDescricao } from "../../../ingestao/normalizar-descricao";

/**
 * Valor padrão do limite do vínculo de nota: errar o produto muda o número que o dono recebe. A
 * variável `LIMITE_SIMILARIDADE` não é lida aqui (as ferramentas só recebem o `db`).
 */
export const SIMILARIDADE_PARA_ESCOLHER_PRODUTO = LIMITE_SIMILARIDADE_PADRAO;

/** Candidato da busca do agente: o código de barras é o que o dono vê para distinguir nomes iguais. */
export interface CandidatoDaBusca extends CandidatoProduto {
  codigoBarras: string | null;
}

/** O produto achado traz o nome do cadastro: o id e o nome vêm da mesma consulta do comerciante da sessão. */
export type ProdutoAchado =
  | { tipo: "vinculado"; produtoId: string; nome: string; confianca: number }
  | { tipo: "sugestao"; candidatos: CandidatoDaBusca[] }
  | { tipo: "sem_candidato" };

/** Produto escolhido pelo dono entre os candidatos: o id só vale se for do comerciante da sessão. */
export async function buscarProdutoPorId(
  db: Db,
  comercianteId: string,
  produtoId: string,
): Promise<Extract<ProdutoAchado, { tipo: "vinculado" | "sem_candidato" }>> {
  const resultado = await db.execute<{ produto_id: string; nome: string }>(sql`
    select p.id as produto_id, p.nome
      from produto p
     where p.id = ${produtoId} and p.comerciante_id = ${comercianteId}
  `);
  const [linha] = resultado.rows;
  if (!linha) return { tipo: "sem_candidato" };
  return { tipo: "vinculado", produtoId: linha.produto_id, nome: linha.nome, confianca: 1 };
}

/**
 * Produtos que a descrição confirmada pelo dono identifica quando não se sabe o fornecedor. A mesma
 * descrição pode ser produtos diferentes em fornecedores diferentes (o vínculo guarda o fornecedor), e a
 * correção do dono entra como linha nova: vale o vínculo mais recente de cada fornecedor.
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
  const atualPorFornecedor = new Map<string | null, string>();
  for (const l of linhas) {
    if (!atualPorFornecedor.has(l.fornecedorId)) atualPorFornecedor.set(l.fornecedorId, l.produtoId);
  }
  return [...new Set(atualPorFornecedor.values())];
}

/** Os produtos dados, do comerciante da sessão, como candidatos para o dono escolher. */
async function candidatosPorId(
  db: Db,
  comercianteId: string,
  produtoIds: string[],
): Promise<CandidatoDaBusca[]> {
  const resultado = await db.execute<{ produto_id: string; nome: string; codigo_barras: string | null }>(sql`
    select p.id as produto_id, p.nome, p.codigo_barras
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
    similaridade: 1,
  }));
}

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
  if (confirmados.length === 1) return buscarProdutoPorId(db, comercianteId, confirmados[0]!);
  if (confirmados.length > 1) {
    return { tipo: "sugestao", candidatos: await candidatosPorId(db, comercianteId, confirmados) };
  }
  const resultado = await db.execute<{
    produto_id: string;
    nome: string;
    codigo_barras: string | null;
    sim: number;
    palavra: number;
  }>(sql`
    select * from (
      select produto_id, max(nome) as nome, max(codigo_barras) as codigo_barras,
             max(similarity(texto, ${consulta}))::float8 as sim,
             max(word_similarity(${consulta}, texto))::float8 as palavra
        from (${textosDosProdutos(comercianteId)}) fonte
       group by produto_id
    ) t
    order by greatest(sim, palavra) desc, nome asc, produto_id asc
    limit 20
  `);
  const pelaPalavra = resultado.rows.every((l) => l.sim < SIMILARIDADE_PARA_ESCOLHER_PRODUTO);
  const candidatos = resultado.rows
    .map((l) => ({
      produtoId: l.produto_id,
      nome: l.nome,
      codigoBarras: l.codigo_barras,
      similaridade: pelaPalavra ? l.palavra : l.sim,
    }))
    .sort((x, y) => y.similaridade - x.similaridade || x.nome.localeCompare(y.nome, "pt-BR"));
  const decisao = decidirPorSimilaridade(candidatos, SIMILARIDADE_PARA_ESCOLHER_PRODUTO);
  if (decisao.tipo === "sem_candidato") return decisao;
  if (decisao.tipo === "sugestao") {
    const ids = new Set(decisao.candidatos.map((c) => c.produtoId));
    return { tipo: "sugestao", candidatos: candidatos.filter((c) => ids.has(c.produtoId)) };
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
