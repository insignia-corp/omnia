/**
 * Junta a camada de dados às funções puras de métrica (issue #32). É o que as ferramentas do
 * agente chamam. O comerciante vem do contexto da sessão, nunca do modelo (regra inviolável 3):
 * um id de produto de outro lojista não é encontrado.
 */
import { somarDias } from "../lib/datas/datas";
import { DIAS_DE_HISTORICO_DO_GIRO, calcularGiro, type Giro } from "./giro";
import { PARAMETROS_MARGEM, calcularMargemDoProduto, type MargemDoProduto } from "./margem-por-produto";
import type { FonteDeDadosMetricas } from "./repositorio-metricas";
import { dadoAusente, type DadoAusente, type ResultadoMetrica } from "./resultado-metrica";
import { DIAS_DE_COMPARACAO_DO_RESUMO, calcularResumoDiario, type ResumoDiario } from "./resumo-diario";
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
    const naoEncontrado = dadoAusente(
      "produto_nao_encontrado",
      "Não encontrei esse produto no seu cadastro.",
    );
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
  async giro(contexto: ContextoMetricas): Promise<ResultadoMetrica<Giro>> {
    const { comercianteId, dataReferencia } = contexto;
    const desde = somarDias(dataReferencia, -(DIAS_DE_HISTORICO_DO_GIRO - 1));
    const [produtos, vendas] = await Promise.all([
      this.dados.produtos(comercianteId),
      this.dados.vendasPorProdutoPorDia(comercianteId, desde, dataReferencia),
    ]);
    return calcularGiro({ produtos, vendas, dataReferencia });
  }

  /** Resumo de um dia (a data de referência, se não for indicada outra). */
  async resumoDiario(
    contexto: ContextoMetricas,
    data: string = contexto.dataReferencia,
  ): Promise<ResultadoMetrica<ResumoDiario> | DadoAusente> {
    const { comercianteId } = contexto;
    const desde = somarDias(data, -DIAS_DE_COMPARACAO_DO_RESUMO);
    const [vendas, intervaloDeVendas, movimentos, contas] = await Promise.all([
      this.dados.vendasPorDia(comercianteId, desde, data),
      this.dados.intervaloDeVendas(comercianteId),
      this.dados.movimentosPorDia(comercianteId, data),
      this.dados.contas(comercianteId),
    ]);
    return calcularResumoDiario({ data, vendas, intervaloDeVendas, movimentos, contas });
  }
}
