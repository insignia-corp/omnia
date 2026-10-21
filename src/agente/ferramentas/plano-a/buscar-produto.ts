import { sql } from "drizzle-orm";
import type { Db } from "../../../infra/database/database.module";
import { decidirPorSimilaridade, type ResultadoVinculo } from "../../../ingestao/vinculo/vincular-produto";
import { normalizarDescricao } from "../../../ingestao/normalizar-descricao";

/** Mais exigente que o vínculo de nota: aqui o dono digitou o nome, e errar o produto muda o número. */
export const SIMILARIDADE_PARA_ESCOLHER_PRODUTO = 0.4;

/** Mesmo recorte de acentos de `normalizarDescricao`, para comparar o nome do catálogo em SQL. */
const NOME_NORMALIZADO = sql.raw(
  "translate(upper(p.nome), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')",
);

/**
 * Procura um produto do comerciante pelo nome aproximado (`pg_trgm`), com o mesmo critério do
 * vínculo de notas: só escolhe sozinho se for claramente o melhor, senão devolve sugestões.
 * O comerciante vem da sessão, nunca do modelo (regra inviolável 3).
 */
export async function buscarProdutoPorNome(
  db: Db,
  comercianteId: string,
  nome: string,
): Promise<ResultadoVinculo> {
  const consulta = normalizarDescricao(nome);
  const resultado = await db.execute<{ produto_id: string; nome: string; sim: number }>(sql`
    select p.id as produto_id, p.nome, similarity(${NOME_NORMALIZADO}, ${consulta})::float8 as sim
      from produto p
     where p.comerciante_id = ${comercianteId}
     order by sim desc, p.nome asc, p.id asc
     limit 5
  `);
  return decidirPorSimilaridade(
    resultado.rows.map((l) => ({ produtoId: l.produto_id, nome: l.nome, similaridade: l.sim })),
    SIMILARIDADE_PARA_ESCOLHER_PRODUTO,
  );
}
