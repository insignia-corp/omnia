/**
 * Camada que lê o banco para as métricas (issue #32), separada das funções puras. Toda consulta
 * filtra por `comerciante_id` (regra inviolável 3) e devolve registros já somados por dia, no
 * formato de `dados-de-metricas.ts`. Janelas, limites e desempates ficam nas funções puras.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql, type AnyColumn } from "drizzle-orm";
import type { Db } from "../infra/database/database.module";
import {
  comerciante,
  compra,
  conta,
  historicoCusto,
  itemDeCompra,
  itemDeVenda,
  produto,
  transacao,
  venda,
} from "../infra/database/schema";
import type {
  ContaParaMetrica,
  CustoDeCompra,
  IntervaloDeDados,
  MovimentoDoDia,
  ProdutoParaMetrica,
  VendaDoProdutoNoDia,
  VendasDoDia,
} from "./dados-de-metricas";
import type { OrigemDado } from "./resultado-metrica";

export interface FonteDeDadosMetricas {
  /** Meta de margem do comerciante em bps; nula quando o comerciante não existe. */
  margemMetaDoComerciante(comercianteId: string): Promise<number | null>;
  produtos(comercianteId: string, produtoId?: string): Promise<ProdutoParaMetrica[]>;
  vendasPorProdutoPorDia(
    comercianteId: string,
    desde: string,
    ate: string,
    produtoId?: string,
  ): Promise<VendaDoProdutoNoDia[]>;
  vendasPorDia(comercianteId: string, desde: string, ate: string): Promise<VendasDoDia[]>;
  intervaloDeVendas(comercianteId: string): Promise<IntervaloDeDados | null>;
  /** A leitura vigente de cada item de compra até a data, de qualquer produto ou do indicado. */
  custosDeCompra(comercianteId: string, ate: string, produtoId?: string): Promise<CustoDeCompra[]>;
  /** Movimentos das contas ativas até a data, somados por conta, dia, sentido e categoria. */
  movimentosPorDia(comercianteId: string, ate: string): Promise<MovimentoDoDia[]>;
  /** Contas ativas. */
  contas(comercianteId: string): Promise<ContaParaMetrica[]>;
}

export const FONTE_DE_DADOS_METRICAS = Symbol("FONTE_DE_DADOS_METRICAS");

/** Soma de uma coluna numérica ou bigint: o PostgreSQL devolve texto, então converte. */
const somar = (coluna: AnyColumn) => sql<number>`sum(${coluna})`.mapWith(Number);
const contar = () => sql<number>`count(*)`.mapWith(Number);
const menorConfianca = (coluna: AnyColumn) => sql<number>`min(${coluna})`.mapWith(Number);
/** Origens distintas; vai como texto porque o driver não lê array de enum. */
const origens = (coluna: AnyColumn) => sql<OrigemDado[]>`array_agg(distinct ${coluna}::text)`;

export class RepositorioMetricasPostgres implements FonteDeDadosMetricas {
  constructor(private readonly db: Db) {}

  async margemMetaDoComerciante(comercianteId: string): Promise<number | null> {
    const [linha] = await this.db
      .select({ meta: comerciante.margemMetaBps })
      .from(comerciante)
      .where(eq(comerciante.id, comercianteId));
    return linha?.meta ?? null;
  }

  async produtos(comercianteId: string, produtoId?: string): Promise<ProdutoParaMetrica[]> {
    return this.db
      .select({ id: produto.id, nome: produto.nome, margemMetaBps: produto.margemMetaBps })
      .from(produto)
      .where(and(eq(produto.comercianteId, comercianteId), produtoId ? eq(produto.id, produtoId) : undefined))
      .orderBy(asc(produto.nome), asc(produto.id));
  }

  async vendasPorProdutoPorDia(
    comercianteId: string,
    desde: string,
    ate: string,
    produtoId?: string,
  ): Promise<VendaDoProdutoNoDia[]> {
    const linhas = await this.db
      .select({
        data: venda.data,
        produtoId: itemDeVenda.produtoId,
        quantidade: somar(itemDeVenda.quantidade),
        receitaCentavos: somar(itemDeVenda.valorTotalCentavos),
        registros: contar(),
        menorConfianca: menorConfianca(venda.confianca),
        origens: origens(venda.origem),
      })
      .from(itemDeVenda)
      .innerJoin(
        venda,
        and(eq(venda.id, itemDeVenda.vendaId), eq(venda.comercianteId, itemDeVenda.comercianteId)),
      )
      .where(
        and(
          eq(venda.comercianteId, comercianteId),
          eq(itemDeVenda.comercianteId, comercianteId),
          gte(venda.data, desde),
          lte(venda.data, ate),
          produtoId ? eq(itemDeVenda.produtoId, produtoId) : undefined,
        ),
      )
      .groupBy(venda.data, itemDeVenda.produtoId)
      .orderBy(asc(venda.data), asc(itemDeVenda.produtoId));
    return linhas;
  }

  async vendasPorDia(comercianteId: string, desde: string, ate: string): Promise<VendasDoDia[]> {
    const linhas = await this.db
      .select({
        data: venda.data,
        cupons: contar(),
        faturamentoCentavos: somar(venda.totalCentavos),
        menorConfianca: menorConfianca(venda.confianca),
        origens: origens(venda.origem),
      })
      .from(venda)
      .where(and(eq(venda.comercianteId, comercianteId), gte(venda.data, desde), lte(venda.data, ate)))
      .groupBy(venda.data)
      .orderBy(asc(venda.data));
    return linhas.map((l) => ({ ...l, registros: l.cupons }));
  }

  async intervaloDeVendas(comercianteId: string): Promise<IntervaloDeDados | null> {
    const [linha] = await this.db
      .select({
        primeira: sql<string | null>`min(${venda.data})`,
        ultima: sql<string | null>`max(${venda.data})`,
      })
      .from(venda)
      .where(eq(venda.comercianteId, comercianteId));
    return linha?.primeira && linha.ultima ? { primeira: linha.primeira, ultima: linha.ultima } : null;
  }

  async custosDeCompra(comercianteId: string, ate: string, produtoId?: string): Promise<CustoDeCompra[]> {
    // Uma leitura por item de compra: se o dono corrigiu o custo, vale a linha mais recente.
    const linhas = await this.db
      .selectDistinctOn([historicoCusto.itemDeCompraId], {
        produtoId: historicoCusto.produtoId,
        fornecedorId: historicoCusto.fornecedorId,
        compraId: itemDeCompra.compraId,
        itemDeCompraId: historicoCusto.itemDeCompraId,
        data: historicoCusto.data,
        custoUnitarioCentavos: historicoCusto.custoUnitarioCentavos,
        confiancaDaLeitura: historicoCusto.confianca,
        confiancaDaNota: compra.confianca,
        origem: historicoCusto.origem,
        criadoEm: historicoCusto.criadoEm,
      })
      .from(historicoCusto)
      .innerJoin(
        itemDeCompra,
        and(
          eq(itemDeCompra.id, historicoCusto.itemDeCompraId),
          eq(itemDeCompra.comercianteId, historicoCusto.comercianteId),
        ),
      )
      .innerJoin(
        compra,
        and(eq(compra.id, itemDeCompra.compraId), eq(compra.comercianteId, itemDeCompra.comercianteId)),
      )
      .where(
        and(
          eq(historicoCusto.comercianteId, comercianteId),
          lte(historicoCusto.data, ate),
          produtoId ? eq(historicoCusto.produtoId, produtoId) : undefined,
        ),
      )
      .orderBy(asc(historicoCusto.itemDeCompraId), desc(historicoCusto.criadoEm), desc(historicoCusto.id));
    return linhas.map(({ confiancaDaLeitura, confiancaDaNota, ...resto }) => ({
      ...resto,
      confianca: Math.min(confiancaDaLeitura, confiancaDaNota),
    }));
  }

  async movimentosPorDia(comercianteId: string, ate: string): Promise<MovimentoDoDia[]> {
    const contasAtivas = await this.contas(comercianteId);
    if (contasAtivas.length === 0) return [];
    const linhas = await this.db
      .select({
        contaId: transacao.contaId,
        data: transacao.data,
        tipo: transacao.tipo,
        categoria: transacao.categoria,
        totalCentavos: somar(transacao.valorCentavos),
        registros: contar(),
        menorConfianca: menorConfianca(transacao.confianca),
        origens: origens(transacao.origem),
      })
      .from(transacao)
      .where(
        and(
          eq(transacao.comercianteId, comercianteId),
          inArray(
            transacao.contaId,
            contasAtivas.map((c) => c.id),
          ),
          lte(transacao.data, ate),
        ),
      )
      .groupBy(transacao.contaId, transacao.data, transacao.tipo, transacao.categoria)
      .orderBy(asc(transacao.data), asc(transacao.contaId), asc(transacao.tipo));
    return linhas;
  }

  async contas(comercianteId: string): Promise<ContaParaMetrica[]> {
    return this.db
      .select({
        id: conta.id,
        saldoInicialCentavos: conta.saldoInicialCentavos,
        saldoInicialEm: conta.saldoInicialEm,
      })
      .from(conta)
      .where(and(eq(conta.comercianteId, comercianteId), eq(conta.status, "ativo")))
      .orderBy(asc(conta.id));
  }
}
