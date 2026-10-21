/**
 * Margem por produto (issue #33): (preço médio de venda - custo da compra mais recente) / preço
 * médio de venda. Usa o custo mais recente porque é o que a reposição vai custar. Fórmula e
 * limites em docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
 */
import { somarDias } from "../lib/datas/datas";
import {
  custoMaisRecente,
  procedenciaDoProduto,
  type CustoDeCompra,
  type ProdutoParaMetrica,
  type VendaDoProdutoNoDia,
} from "./dados-de-metricas";
import { percentualDeBps, razaoEmBps } from "./pontos-base";
import { somarQuantidades } from "./quantidades";
import {
  dadoAusente,
  procedenciaDeUmRegistro,
  resultadoMetrica,
  type DadoAusente,
  type ResultadoMetrica,
} from "./resultado-metrica";

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_MARGEM = { janelaPrecoDias: 30 } as const;
export type ParametrosMargem = { readonly janelaPrecoDias: number };

export interface MargemDoProduto {
  produto_id: string;
  nome: string;
  /** Receita dividida pelas unidades vendidas na janela, arredondada em centavos. */
  preco_medio_venda_centavos: number;
  unidades_vendidas: number;
  custo_compra_mais_recente_centavos: number;
  compra_data: string;
  fornecedor_id: string;
  margem_bps: number;
  margem_percentual: number;
  /** A meta do produto, ou a do comerciante quando o produto não tem a própria. */
  meta_bps: number;
  meta_percentual: number;
  abaixo_da_meta: boolean;
}

export interface EntradaMargem {
  produto: ProdutoParaMetrica;
  /** Meta de margem do comerciante, usada quando o produto não tem a própria. */
  margemMetaComercianteBps: number;
  /** Vendas do produto em qualquer dia: a função recorta a janela de preço. */
  vendas: readonly VendaDoProdutoNoDia[];
  /** Leituras de custo do produto, de qualquer fornecedor. */
  custos: readonly CustoDeCompra[];
  dataReferencia: string;
}

/**
 * Margem de um produto na data de referência. Devolve dado ausente, com o que perguntar ao dono,
 * quando falta custo (nenhuma nota de compra) ou venda (nada vendido na janela): nunca estima.
 */
export function calcularMargemDoProduto(
  entrada: EntradaMargem,
  parametros: ParametrosMargem = PARAMETROS_MARGEM,
): ResultadoMetrica<MargemDoProduto> | DadoAusente {
  const { produto, dataReferencia } = entrada;
  const inicio = somarDias(dataReferencia, -(parametros.janelaPrecoDias - 1));
  const vendas = entrada.vendas.filter((v) => v.data >= inicio && v.data <= dataReferencia);
  const custo = custoMaisRecente(entrada.custos, dataReferencia);

  if (custo === null) {
    return dadoAusente(
      "sem_custo",
      `Não há nota de compra de ${produto.nome}, então a margem não pode ser calculada.`,
      `Qual é o custo de compra de ${produto.nome}?`,
    );
  }
  const unidades = somarQuantidades(vendas.map((v) => v.quantidade));
  if (unidades <= 0) {
    return dadoAusente(
      "sem_venda_na_janela",
      `${produto.nome} não vendeu nos últimos ${parametros.janelaPrecoDias} dias, então não há preço médio de venda.`,
    );
  }

  const receita = vendas.reduce((soma, v) => soma + v.receitaCentavos, 0);
  const preco = Math.round(receita / unidades);
  const margemBps = razaoEmBps(preco - custo.custoUnitarioCentavos, preco);
  if (margemBps === null) {
    return dadoAusente("preco_medio_zero", `O preço médio de venda de ${produto.nome} é zero.`);
  }
  const meta = produto.margemMetaBps ?? entrada.margemMetaComercianteBps;

  return resultadoMetrica<MargemDoProduto>(
    {
      produto_id: produto.id,
      nome: produto.nome,
      preco_medio_venda_centavos: preco,
      unidades_vendidas: unidades,
      custo_compra_mais_recente_centavos: custo.custoUnitarioCentavos,
      compra_data: custo.data,
      fornecedor_id: custo.fornecedorId,
      margem_bps: margemBps,
      margem_percentual: percentualDeBps(margemBps),
      meta_bps: meta,
      meta_percentual: percentualDeBps(meta),
      abaixo_da_meta: margemBps < meta,
    },
    { inicio, fim: dataReferencia },
    [...vendas, procedenciaDeUmRegistro(custo.origem, custo.confianca), procedenciaDoProduto(produto)],
  );
}
