import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Executor } from "../../infra/database/database.module";
import { produto, vinculoDescricaoProduto } from "../../infra/database/schema";
import { normalizarGtin } from "../../lib/gtin/gtin";
import { normalizarDescricao } from "../normalizar-descricao";

/** Abaixo disto o candidato nem entra como sugestão: é ruído, não semelhança. */
export const SIMILARIDADE_MINIMA_SUGESTAO = 0.2;
/** O melhor candidato precisa passar do segundo por esta folga para ligar sozinho. */
export const MARGEM_SOBRE_O_SEGUNDO = 0.1;
const MAXIMO_SUGESTOES = 3;

export interface CandidatoProduto {
  produtoId: string;
  nome: string;
  /** Similaridade de trigramas, de 0 a 1. */
  similaridade: number;
}

export type ResultadoVinculo =
  /** Ligou sem perguntar: código de barras, vínculo confirmado antes pelo dono, ou similaridade acima do limite. */
  | {
      tipo: "vinculado";
      produtoId: string;
      metodo: "codigo_barras" | "dono" | "similaridade";
      confianca: number;
    }
  /** Há candidatos plausíveis, mas nenhum com certeza: o dono escolhe. */
  | { tipo: "sugestao"; candidatos: CandidatoProduto[] }
  | { tipo: "sem_candidato" };

/**
 * Decide, só pela similaridade, entre ligar sozinho, sugerir ao dono ou desistir. Função pura: o
 * critério (limite e folga sobre o segundo colocado) é o que mantém o vínculo errado fora do
 * histórico de custo. `candidatos` vem ordenado do mais para o menos parecido.
 */
export function decidirPorSimilaridade(candidatos: CandidatoProduto[], limite: number): ResultadoVinculo {
  const plausiveis = candidatos.filter((c) => c.similaridade >= SIMILARIDADE_MINIMA_SUGESTAO);
  const [melhor, segundo] = plausiveis;
  if (!melhor) return { tipo: "sem_candidato" };
  const folga = segundo ? melhor.similaridade - segundo.similaridade : 1;
  if (melhor.similaridade >= limite && folga >= MARGEM_SOBRE_O_SEGUNDO) {
    return {
      tipo: "vinculado",
      produtoId: melhor.produtoId,
      metodo: "similaridade",
      confianca: melhor.similaridade,
    };
  }
  return { tipo: "sugestao", candidatos: plausiveis.slice(0, MAXIMO_SUGESTOES) };
}

export interface BuscaVinculo {
  comercianteId: string;
  /** Nulo quando o fornecedor da nota ainda não existe: só vale a memória de qualquer fornecedor. */
  fornecedorId: string | null;
  /** Descrição como impressa na nota. */
  descricao: string;
  limiteSimilaridade: number;
  /** Código de barras do item, quando a origem o traz (NF-e). Sem dígito verificador válido, é ignorado. */
  codigoBarras?: string | null;
}

/** Mesmo recorte de acentos de `normalizarDescricao`, para comparar o nome do catálogo em SQL. */
export const NOME_NORMALIZADO = sql.raw(
  "translate(upper(p.nome), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC')",
);

/** Vínculo confirmado pelo dono para a descrição exata: o do fornecedor vale mais; entre iguais, o mais recente. */
export async function buscarDescricaoConfirmada(
  db: Executor,
  comercianteId: string,
  descricaoNormalizada: string,
  fornecedorId: string | null,
): Promise<string | null> {
  const [confirmado] = await db
    .select({ produtoId: vinculoDescricaoProduto.produtoId })
    .from(vinculoDescricaoProduto)
    .where(
      and(
        eq(vinculoDescricaoProduto.comercianteId, comercianteId),
        eq(vinculoDescricaoProduto.descricaoNormalizada, descricaoNormalizada),
        eq(vinculoDescricaoProduto.confirmadoPeloDono, true),
      ),
    )
    // O do mesmo fornecedor vale mais; entre iguais, o mais recente.
    .orderBy(
      sql`(${vinculoDescricaoProduto.fornecedorId} = ${fornecedorId}) desc nulls last`,
      desc(vinculoDescricaoProduto.criadoEm),
    )
    .limit(1);
  return confirmado?.produtoId ?? null;
}

/**
 * Textos que identificam cada produto do comerciante: o nome do catálogo (com o recorte de
 * `normalizarDescricao`) e as descrições que o dono já confirmou. Base da similaridade do vínculo de
 * nota e da busca por nome das ferramentas do agente.
 */
export function textosDosProdutos(comercianteId: string): SQL {
  return sql`
    select p.id as produto_id, p.nome, p.codigo_barras, ${NOME_NORMALIZADO} as texto
      from produto p
     where p.comerciante_id = ${comercianteId}
    union all
    select v.produto_id, p.nome, p.codigo_barras, v.descricao_normalizada as texto
      from vinculo_descricao_produto v
      join produto p on p.id = v.produto_id and p.comerciante_id = v.comerciante_id
     where v.comerciante_id = ${comercianteId} and v.confirmado_pelo_dono`;
}

/**
 * Liga a descrição de uma nota a um produto (issue #27), na ordem do guia sem o modelo:
 * 1. código de barras do item (GTIN válido) igual ao de um produto do comerciante;
 * 2. vínculo já confirmado pelo dono, do mesmo fornecedor e depois de qualquer fornecedor;
 * 3. similaridade `pg_trgm` contra o catálogo e contra descrições já confirmadas.
 * Tudo filtrado por `comerciante_id`. A foto de nota não traz código de barras; a NF-e traz.
 */
export async function buscarVinculo(db: Executor, busca: BuscaVinculo): Promise<ResultadoVinculo> {
  const descricao = normalizarDescricao(busca.descricao);

  // O código identifica o produto sem ambiguidade, então vale mais que a memória do dono.
  const gtin = normalizarGtin(busca.codigoBarras);
  if (gtin) {
    const [pelaEtiqueta] = await db
      .select({ id: produto.id })
      .from(produto)
      .where(and(eq(produto.comercianteId, busca.comercianteId), eq(produto.codigoBarras, gtin)))
      .limit(1);
    if (pelaEtiqueta) {
      return { tipo: "vinculado", produtoId: pelaEtiqueta.id, metodo: "codigo_barras", confianca: 1 };
    }
  }

  const confirmado = await buscarDescricaoConfirmada(db, busca.comercianteId, descricao, busca.fornecedorId);
  if (confirmado) return { tipo: "vinculado", produtoId: confirmado, metodo: "dono", confianca: 1 };

  const resultado = await db.execute<{ produto_id: string; nome: string; sim: number }>(sql`
    select produto_id, max(nome) as nome, max(similarity(texto, ${descricao}))::float8 as sim
      from (${textosDosProdutos(busca.comercianteId)}) fonte
     group by produto_id
     order by sim desc
     limit 5
  `);
  return decidirPorSimilaridade(
    resultado.rows.map((l) => ({ produtoId: l.produto_id, nome: l.nome, similaridade: l.sim })),
    busca.limiteSimilaridade,
  );
}

export interface NovoVinculo {
  comercianteId: string;
  fornecedorId: string;
  descricao: string;
  produtoId: string;
  metodo: "similaridade" | "dono" | "modelo";
  confianca: number;
  confirmadoPeloDono: boolean;
}

/**
 * Registra o vínculo descrição-produto. A tabela é append-only (vale o mais recente da chave), então
 * só insere quando ainda não há uma linha igual: reprocessar uma nota não enche o histórico.
 */
export async function registrarVinculo(db: Executor, v: NovoVinculo): Promise<void> {
  const descricaoNormalizada = normalizarDescricao(v.descricao);
  const [igual] = await db
    .select({ id: vinculoDescricaoProduto.id })
    .from(vinculoDescricaoProduto)
    .where(
      and(
        eq(vinculoDescricaoProduto.comercianteId, v.comercianteId),
        eq(vinculoDescricaoProduto.fornecedorId, v.fornecedorId),
        eq(vinculoDescricaoProduto.descricaoNormalizada, descricaoNormalizada),
        eq(vinculoDescricaoProduto.produtoId, v.produtoId),
        eq(vinculoDescricaoProduto.confirmadoPeloDono, v.confirmadoPeloDono),
      ),
    )
    .limit(1);
  if (igual) return;
  await db.insert(vinculoDescricaoProduto).values({
    comercianteId: v.comercianteId,
    fornecedorId: v.fornecedorId,
    descricaoNormalizada,
    produtoId: v.produtoId,
    metodo: v.metodo,
    confianca: v.confianca,
    confirmadoPeloDono: v.confirmadoPeloDono,
    confirmadoEm: v.confirmadoPeloDono ? new Date() : null,
  });
}
