/**
 * Variação de custo (issue #35): (custo da compra atual - custo da compra anterior) / custo
 * anterior, sempre do mesmo produto e do mesmo fornecedor. Outro fornecedor com custo diferente
 * não é reajuste. Fórmula e limites em docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
 */
import { diasEntre } from "../lib/datas/datas";
import {
  compararCustos,
  compararNomes,
  compararTexto,
  procedenciaDoProduto,
  type CustoDeCompra,
  type ProdutoParaMetrica,
} from "./dados-de-metricas";
import { percentualDeBps, razaoEmBps } from "./pontos-base";
import { procedenciaDeUmRegistro, resultadoMetrica, type ResultadoMetrica } from "./resultado-metrica";

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_VARIACAO_CUSTO = { limiteBps: 500, janelaAlertaDias: 7 } as const;
export type ParametrosVariacaoCusto = { readonly limiteBps: number; readonly janelaAlertaDias: number };

export interface VariacaoDeCusto {
  produto_id: string;
  nome: string;
  fornecedor_id: string;
  custo_anterior_centavos: number;
  custo_atual_centavos: number;
  compra_anterior_data: string;
  compra_atual_data: string;
  /** Positiva no reajuste, negativa quando o custo caiu. */
  variacao_bps: number;
  variacao_percentual: number;
  /** A variação passa do limite (alta de mais de 5%, no valor inicial). */
  acima_do_limite: boolean;
  /** A compra atual é de no máximo `janelaAlertaDias` antes da data de referência. */
  recente: boolean;
  /** A menor confiança entre a compra atual e a anterior, para o agente tratar cada reajuste por si. */
  menor_confianca: number;
}

export interface EntradaVariacaoDeCusto {
  produtos: readonly ProdutoParaMetrica[];
  /** Leituras de custo de qualquer produto e fornecedor; a função agrupa e recorta. */
  custos: readonly CustoDeCompra[];
  dataReferencia: string;
}

/**
 * Variação entre as duas últimas compras de cada par produto e fornecedor, da maior alta para a
 * maior queda. Pares com uma só compra, sem mudança de custo ou com custo anterior zero ficam de
 * fora. A compra anterior é sempre de outra nota: duas linhas do mesmo produto na mesma nota não
 * são um reajuste.
 */
export function calcularVariacoesDeCusto(
  entrada: EntradaVariacaoDeCusto,
  parametros: ParametrosVariacaoCusto = PARAMETROS_VARIACAO_CUSTO,
): ResultadoMetrica<VariacaoDeCusto[]> {
  const { dataReferencia } = entrada;
  const produtosPorId = new Map(entrada.produtos.map((p) => [p.id, p]));

  const pares = new Map<string, CustoDeCompra[]>();
  for (const custo of entrada.custos) {
    if (custo.data > dataReferencia) continue;
    const chave = `${custo.produtoId}|${custo.fornecedorId}`;
    pares.set(chave, [...(pares.get(chave) ?? []), custo]);
  }

  const variacoes: VariacaoDeCusto[] = [];
  const usados: CustoDeCompra[] = [];
  const produtosUsados = new Map<string, ProdutoParaMetrica>();
  for (const compras of pares.values()) {
    const emOrdem = [...compras].sort(compararCustos);
    const atual = emOrdem.at(-1);
    if (!atual) continue;
    const anterior = emOrdem.findLast((c) => c.compraId !== atual.compraId);
    if (!anterior) continue;

    const variacaoBps = razaoEmBps(
      atual.custoUnitarioCentavos - anterior.custoUnitarioCentavos,
      anterior.custoUnitarioCentavos,
    );
    if (variacaoBps === null || variacaoBps === 0) continue;

    variacoes.push({
      produto_id: atual.produtoId,
      nome: produtosPorId.get(atual.produtoId)?.nome ?? "",
      fornecedor_id: atual.fornecedorId,
      custo_anterior_centavos: anterior.custoUnitarioCentavos,
      custo_atual_centavos: atual.custoUnitarioCentavos,
      compra_anterior_data: anterior.data,
      compra_atual_data: atual.data,
      variacao_bps: variacaoBps,
      variacao_percentual: percentualDeBps(variacaoBps),
      acima_do_limite: variacaoBps > parametros.limiteBps,
      recente: diasEntre(atual.data, dataReferencia) <= parametros.janelaAlertaDias,
      menor_confianca: Math.min(
        atual.confianca,
        anterior.confianca,
        produtosPorId.get(atual.produtoId)?.confianca ?? 1,
      ),
    });
    usados.push(atual, anterior);
    const produto = produtosPorId.get(atual.produtoId);
    if (produto) produtosUsados.set(produto.id, produto);
  }

  variacoes.sort(
    (a, b) =>
      b.variacao_bps - a.variacao_bps ||
      compararNomes(a.nome, b.nome) ||
      compararTexto(a.fornecedor_id, b.fornecedor_id),
  );
  const inicio = usados.map((c) => c.data).sort(compararTexto)[0] ?? dataReferencia;
  return resultadoMetrica(variacoes, { inicio, fim: dataReferencia }, [
    ...usados.map((c) => procedenciaDeUmRegistro(c.origem, c.confianca)),
    ...[...produtosUsados.values()].map(procedenciaDoProduto),
  ]);
}
