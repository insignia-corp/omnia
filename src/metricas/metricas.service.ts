/**
 * Junta a camada de dados às funções puras de métrica (issue #32). É o que as ferramentas do
 * agente chamam. O comerciante vem do contexto da sessão, nunca do modelo (regra inviolável 3):
 * um id de produto de outro lojista não é encontrado.
 */
import { somarDias } from "../lib/datas/datas";
import { intervaloComumDeMovimentos } from "./dados-de-metricas";
import { calcularEspacoParaSubirPreco, type ProdutoComEspacoParaSubirPreco } from "./espaco-para-subir-preco";
import { calcularEstoqueParado, type ProdutoParado } from "./estoque-parado";
import {
  PARAMETROS_GASTO_FORA_DO_PADRAO,
  calcularGastoForaDoPadrao,
  type GastoForaDoPadrao,
} from "./gasto-fora-do-padrao";
import { DIAS_DE_HISTORICO_DO_GIRO, calcularGiro, type Giro } from "./giro";
import { PARAMETROS_MARGEM, calcularMargemDoProduto, type MargemDoProduto } from "./margem-por-produto";
import { produtoNaoEncontrado } from "./produto-nao-encontrado";
import { calcularReceitaPorProduto, DIAS_DA_RECEITA, type ReceitaPorProduto } from "./receita-por-produto";
import type { FonteDeDadosMetricas } from "./repositorio-metricas";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "./resultado-metrica";
import {
  calcularResumoDePeriodo,
  periodosDoResumo,
  type ResumoDePeriodo,
  type TipoPeriodo,
} from "./resumo-de-periodo";
import { DIAS_DE_COMPARACAO_DO_RESUMO, calcularResumoDiario, type ResumoDiario } from "./resumo-diario";
import { DIAS_DE_HISTORICO_DO_TICKET, calcularTicketMedio, type TicketMedio } from "./ticket-medio";
import { calcularVariacoesDeCusto, type VariacaoDeCusto } from "./variacao-de-custo";

/** O que as métricas precisam saber da sessão. `ContextoSessao` das ferramentas serve. */
export interface ContextoMetricas {
  comercianteId: string;
  /** Data de referência (ISO). As métricas não leem o relógio. */
  dataReferencia: string;
}

export interface MargemDeProduto {
  produto_id: string;
  resultado: ResultadoMetrica<MargemDoProduto> | DadoAusente;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function agrupar<T>(itens: readonly T[], chave: (item: T) => string): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const item of itens) {
    const grupo = grupos.get(chave(item));
    if (grupo) grupo.push(item);
    else grupos.set(chave(item), [item]);
  }
  return grupos;
}

export class MetricasService {
  constructor(private readonly dados: FonteDeDadosMetricas) {}

  /** Margem de um produto do comerciante. Produto de outro lojista ou inexistente vira dado ausente. */
  async margemDoProduto(
    contexto: ContextoMetricas,
    produtoId: string,
  ): Promise<ResultadoMetrica<MargemDoProduto> | DadoAusente> {
    const { comercianteId, dataReferencia } = contexto;
    const naoEncontrado = produtoNaoEncontrado();
    if (!UUID.test(produtoId)) return naoEncontrado;

    const [produtos, meta] = await Promise.all([
      this.dados.produtos(comercianteId, produtoId),
      this.dados.margemMetaDoComerciante(comercianteId),
    ]);
    const produto = produtos[0];
    if (!produto || meta === null) return naoEncontrado;

    const desde = somarDias(dataReferencia, -(PARAMETROS_MARGEM.janelaPrecoDias - 1));
    const [vendas, custos] = await Promise.all([
      this.dados.vendasPorProdutoPorDia(comercianteId, desde, dataReferencia, produtoId),
      this.dados.custosDeCompra(comercianteId, dataReferencia, produtoId),
    ]);
    return calcularMargemDoProduto({
      produto,
      margemMetaComercianteBps: meta,
      vendas,
      custos,
      dataReferencia,
    });
  }

  /** Margem de todos os produtos do comerciante, para o motor de alertas e os rankings. */
  async margensDosProdutos(contexto: ContextoMetricas): Promise<MargemDeProduto[]> {
    const { comercianteId, dataReferencia } = contexto;
    const desde = somarDias(dataReferencia, -(PARAMETROS_MARGEM.janelaPrecoDias - 1));
    const [produtos, meta, vendas, custos] = await Promise.all([
      this.dados.produtos(comercianteId),
      this.dados.margemMetaDoComerciante(comercianteId),
      this.dados.vendasPorProdutoPorDia(comercianteId, desde, dataReferencia),
      this.dados.custosDeCompra(comercianteId, dataReferencia),
    ]);
    if (meta === null) return [];

    const vendasPorProduto = agrupar(vendas, (v) => v.produtoId);
    const custosPorProduto = agrupar(custos, (c) => c.produtoId);
    return produtos.map((produto) => ({
      produto_id: produto.id,
      resultado: calcularMargemDoProduto({
        produto,
        margemMetaComercianteBps: meta,
        vendas: vendasPorProduto.get(produto.id) ?? [],
        custos: custosPorProduto.get(produto.id) ?? [],
        dataReferencia,
      }),
    }));
  }

  /** Variação de custo de cada par produto e fornecedor com pelo menos duas compras. */
  async variacoesDeCusto(contexto: ContextoMetricas): Promise<ResultadoMetrica<VariacaoDeCusto[]>> {
    const { comercianteId, dataReferencia } = contexto;
    const [produtos, custos] = await Promise.all([
      this.dados.produtos(comercianteId),
      this.dados.custosDeCompra(comercianteId, dataReferencia),
    ]);
    return calcularVariacoesDeCusto({ produtos, custos, dataReferencia });
  }

  /** Giro dos últimos 7 dias contra a média semanal dos 28 anteriores, com os rankings. */
  async giro(contexto: ContextoMetricas): Promise<ResultadoMetrica<Giro> | DadoAusente> {
    const { comercianteId, dataReferencia } = contexto;
    const desde = somarDias(dataReferencia, -(DIAS_DE_HISTORICO_DO_GIRO - 1));
    const [produtos, vendas, intervaloDeVendas] = await Promise.all([
      this.dados.produtos(comercianteId),
      this.dados.vendasPorProdutoPorDia(comercianteId, desde, dataReferencia),
      this.dados.intervaloDeVendas(comercianteId),
    ]);
    return calcularGiro({ produtos, vendas, intervaloDeVendas, dataReferencia });
  }

  /** Receita de cada produto nos últimos 7 dias, com o ranking dos de maior receita. */
  async receitaPorProduto(
    contexto: ContextoMetricas,
  ): Promise<ResultadoMetrica<ReceitaPorProduto> | DadoAusente> {
    const { comercianteId, dataReferencia } = contexto;
    const desde = somarDias(dataReferencia, -(DIAS_DA_RECEITA - 1));
    const [produtos, vendas, intervaloDeVendas] = await Promise.all([
      this.dados.produtos(comercianteId),
      this.dados.vendasPorProdutoPorDia(comercianteId, desde, dataReferencia),
      this.dados.intervaloDeVendas(comercianteId),
    ]);
    return calcularReceitaPorProduto({ produtos, vendas, intervaloDeVendas, dataReferencia });
  }

  /** Resumo de um dia (a data de referência, se não for indicada outra). */
  async resumoDiario(
    contexto: ContextoMetricas,
    data: string = contexto.dataReferencia,
  ): Promise<ResultadoMetrica<ResumoDiario> | DadoAusente> {
    const { comercianteId } = contexto;
    const desde = somarDias(data, -DIAS_DE_COMPARACAO_DO_RESUMO);
    const [vendas, intervaloDeVendas, movimentos, intervalosPorConta, contas] = await Promise.all([
      this.dados.vendasPorDia(comercianteId, desde, data),
      this.dados.intervaloDeVendas(comercianteId),
      this.dados.movimentosPorDia(comercianteId, data),
      this.dados.intervalosDeMovimentosPorConta(comercianteId),
      this.dados.contas(comercianteId),
    ]);
    return calcularResumoDiario({
      data,
      vendas,
      intervaloDeVendas,
      movimentos,
      intervaloDeMovimentos: intervaloComumDeMovimentos(data, contas, intervalosPorConta),
      contas,
    });
  }

  /** Resumo da semana ou do mês que termina na data (a data de referência, se não for indicada outra). */
  async resumoDePeriodo(
    contexto: ContextoMetricas,
    tipo: TipoPeriodo,
    ate: string = contexto.dataReferencia,
  ): Promise<ResultadoMetrica<ResumoDePeriodo> | DadoAusente> {
    const { comercianteId } = contexto;
    const { atual, anterior } = periodosDoResumo(tipo, ate);
    const [vendas, intervaloDeVendas, movimentos, intervalosPorConta, contas] = await Promise.all([
      this.dados.vendasPorDia(comercianteId, anterior.inicio, ate),
      this.dados.intervaloDeVendas(comercianteId),
      this.dados.movimentosPorDia(comercianteId, ate, atual.inicio),
      this.dados.intervalosDeMovimentosPorConta(comercianteId),
      this.dados.contas(comercianteId),
    ]);
    return calcularResumoDePeriodo({
      tipo,
      ate,
      vendas,
      intervaloDeVendas,
      movimentos,
      intervaloDeMovimentos: intervaloComumDeMovimentos(ate, contas, intervalosPorConta),
    });
  }

  /** Ticket médio de um dia contra a média dos 28 anteriores (a data de referência, se não for indicada outra). */
  async ticketMedio(
    contexto: ContextoMetricas,
    data: string = contexto.dataReferencia,
  ): Promise<ResultadoMetrica<TicketMedio> | DadoAusente> {
    const { comercianteId } = contexto;
    const desde = somarDias(data, -DIAS_DE_HISTORICO_DO_TICKET);
    const [vendas, intervaloDeVendas] = await Promise.all([
      this.dados.vendasPorDia(comercianteId, desde, data),
      this.dados.intervaloDeVendas(comercianteId),
    ]);
    return calcularTicketMedio({ data, vendas, intervaloDeVendas });
  }

  /** Gasto operacional de um dia contra o padrão dos 60 anteriores (a data de referência, se não for indicada outra). */
  async gastoForaDoPadrao(
    contexto: ContextoMetricas,
    data: string = contexto.dataReferencia,
  ): Promise<ResultadoMetrica<GastoForaDoPadrao> | DadoAusente> {
    const { comercianteId } = contexto;
    const desde = somarDias(data, -PARAMETROS_GASTO_FORA_DO_PADRAO.janelaDias);
    const [movimentos, intervalosPorConta, contas] = await Promise.all([
      this.dados.movimentosPorDia(comercianteId, data, desde),
      this.dados.intervalosDeMovimentosPorConta(comercianteId),
      this.dados.contas(comercianteId),
    ]);
    return calcularGastoForaDoPadrao({
      data,
      movimentos,
      intervaloDeMovimentos: intervaloComumDeMovimentos(data, contas, intervalosPorConta),
    });
  }

  /** Produtos comprados há mais tempo sem vender. */
  async estoqueParado(contexto: ContextoMetricas): Promise<ResultadoMetrica<ProdutoParado[]>> {
    const { comercianteId, dataReferencia } = contexto;
    const [produtos, custos, ultimasVendas] = await Promise.all([
      this.dados.produtos(comercianteId),
      this.dados.custosDeCompra(comercianteId, dataReferencia),
      this.dados.ultimasVendasPorProduto(comercianteId, dataReferencia),
    ]);
    return calcularEstoqueParado({ produtos, custos, ultimasVendas, dataReferencia });
  }

  /** Produtos de giro alto com margem abaixo da meta. */
  async espacoParaSubirPreco(
    contexto: ContextoMetricas,
  ): Promise<ResultadoMetrica<ProdutoComEspacoParaSubirPreco[]> | DadoAusente> {
    const [giro, margens] = await Promise.all([this.giro(contexto), this.margensDosProdutos(contexto)]);
    if (ehDadoAusente(giro)) return giro;
    return calcularEspacoParaSubirPreco({ giro, margens });
  }
}
