import { sql } from "drizzle-orm";
import { LIMITE_SIMILARIDADE_PADRAO } from "../../../config/env";
import type { Db } from "../../../infra/database/database.module";
import { decidirPorSimilaridade, type CandidatoProduto } from "../../../ingestao/vinculo/vincular-produto";
import { normalizarDescricao } from "../../../ingestao/normalizar-descricao";

/**
 * Valor padrão do limite do vínculo de nota: errar o produto muda o número que o dono recebe. A
 * variável `LIMITE_SIMILARIDADE` não é lida aqui (as ferramentas só recebem o `db`).
 */
export const SIMILARIDADE_PARA_ESCOLHER_PRODUTO = LIMITE_SIMILARIDADE_PADRAO;

/** Mesmo recorte de acentos de `normalizarDescricao`, para comparar o nome do catálogo em SQL. */
const NOME_NORMALIZADO = sql.raw(
  "translate(upper(p.nome), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')",
);

/** O produto achado traz o nome do cadastro: o id e o nome vêm da mesma consulta do comerciante da sessão. */
export type ProdutoAchado =
  | { tipo: "vinculado"; produtoId: string; nome: string; confianca: number }
  | { tipo: "sugestao"; candidatos: CandidatoProduto[] }
  | { tipo: "sem_candidato" };

/**
 * Procura um produto do comerciante pelo nome aproximado (`pg_trgm`), com o mesmo critério do
 * vínculo de notas: só escolhe sozinho se for claramente o melhor, senão devolve sugestões.
 * O comerciante vem da sessão, nunca do modelo (regra inviolável 3).
 */
export async function buscarProdutoPorNome(
  db: Db,
  comercianteId: string,
  nome: string,
): Promise<ProdutoAchado> {
  const consulta = normalizarDescricao(nome);
  const resultado = await db.execute<{ produto_id: string; nome: string; sim: number }>(sql`
    select p.id as produto_id, p.nome, similarity(${NOME_NORMALIZADO}, ${consulta})::float8 as sim
      from produto p
     where p.comerciante_id = ${comercianteId}
     order by sim desc, p.nome asc, p.id asc
     limit 5
  `);
  const candidatos = resultado.rows.map((l) => ({
    produtoId: l.produto_id,
    nome: l.nome,
    similaridade: l.sim,
  }));
  const decisao = decidirPorSimilaridade(candidatos, SIMILARIDADE_PARA_ESCOLHER_PRODUTO);
  if (decisao.tipo !== "vinculado") return decisao;
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
