/**
 * Estoque parado (issue #37): dias sem venda de um produto que já foi comprado. Sem dado de
 * estoque, "parado" é só tempo desde a última venda. Fórmula e limites em
 * docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
 *
 * Produto que nunca foi comprado fica de fora (não há estoque a parar) e o que nunca vendeu na
 * base também (sem a última venda não há como medir os dias).
 */
import { diasEntre } from "../lib/datas/datas";
import {
  compararNomes,
  compararTexto,
  custoMaisRecente,
  type CustoDeCompra,
  type ProdutoParaMetrica,
  type UltimaVendaDoProduto,
} from "./dados-de-metricas";
import {
  procedenciaDeUmRegistro,
  resultadoMetrica,
  type Procedencia,
  type ResultadoMetrica,
} from "./resultado-metrica";

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_ESTOQUE_PARADO = { limiteDias: 30, topN: 5 } as const;
export type ParametrosEstoqueParado = { readonly limiteDias: number; readonly topN: number };

export interface ProdutoParado {
  produto_id: string;
  nome: string;
  ultima_venda: string;
  dias_sem_venda: number;
  /** Passou do limite de dias sem venda (mais de 30, no valor inicial). */
  parado: boolean;
}

export interface EntradaEstoqueParado {
  produtos: readonly ProdutoParaMetrica[];
  /** Leituras de custo de qualquer produto: só importa se o produto já foi comprado. */
  custos: readonly CustoDeCompra[];
  /** A última venda de cada produto na base inteira. */
  ultimasVendas: readonly UltimaVendaDoProduto[];
  dataReferencia: string;
}

/**
 * Produtos comprados há mais tempo sem vender, do mais para o menos parado. Traz todos os que
 * passaram do limite e completa com os mais próximos dele até o top N, então nenhum parado fica
 * de fora do alerta.
 */
export function calcularEstoqueParado(
  entrada: EntradaEstoqueParado,
  parametros: ParametrosEstoqueParado = PARAMETROS_ESTOQUE_PARADO,
): ResultadoMetrica<ProdutoParado[]> {
  const { dataReferencia } = entrada;
  const ultimaVendaDe = new Map<string, UltimaVendaDoProduto>();
  for (const venda of entrada.ultimasVendas) {
    if (venda.data <= dataReferencia) ultimaVendaDe.set(venda.produtoId, venda);
  }
  const custosPorProduto = new Map<string, CustoDeCompra[]>();
  for (const custo of entrada.custos) {
    const lista = custosPorProduto.get(custo.produtoId);
    if (lista) lista.push(custo);
    else custosPorProduto.set(custo.produtoId, [custo]);
  }

  const candidatos: Array<{ produto: ProdutoParado; fontes: Procedencia[] }> = [];
  for (const produto of entrada.produtos) {
    const compra = custoMaisRecente(custosPorProduto.get(produto.id) ?? [], dataReferencia);
    const ultima = ultimaVendaDe.get(produto.id);
    if (!compra || !ultima) continue;
    const dias = diasEntre(ultima.data, dataReferencia);
    if (dias <= 0) continue;
    candidatos.push({
      produto: {
        produto_id: produto.id,
        nome: produto.nome,
        ultima_venda: ultima.data,
        dias_sem_venda: dias,
        parado: dias > parametros.limiteDias,
      },
      fontes: [ultima, procedenciaDeUmRegistro(compra.origem, compra.confianca)],
    });
  }

  candidatos.sort(
    (a, b) =>
      b.produto.dias_sem_venda - a.produto.dias_sem_venda ||
      compararNomes(a.produto.nome, b.produto.nome) ||
      compararTexto(a.produto.produto_id, b.produto.produto_id),
  );
  const parados = candidatos.filter((c) => c.produto.parado).length;
  const escolhidos = candidatos.slice(0, Math.max(parametros.topN, parados));

  const inicio = escolhidos.map((c) => c.produto.ultima_venda).sort(compararTexto)[0] ?? dataReferencia;
  return resultadoMetrica(
    escolhidos.map((c) => c.produto),
    { inicio, fim: dataReferencia },
    escolhidos.flatMap((c) => c.fontes),
  );
}
