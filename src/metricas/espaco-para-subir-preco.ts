/**
 * Espaço para subir preço (issue #36): giro alto combinado com margem abaixo da meta, as duas
 * condições juntas. Produto que vende bem e já tem margem boa não precisa subir; o que tem margem
 * baixa mas vende pouco corre o risco de perder venda. É uma métrica derivada: usa os resultados
 * de `calcularGiro` e de `calcularMargemDoProduto`, sem reler dados.
 */
import { compararNomes, compararTexto } from "./dados-de-metricas";
import type { Giro } from "./giro";
import type { MargemDoProduto } from "./margem-por-produto";
import {
  ehDadoAusente,
  procedenciaDe,
  resultadoMetrica,
  type DadoAusente,
  type Procedencia,
  type ResultadoMetrica,
} from "./resultado-metrica";

export interface ProdutoComEspacoParaSubirPreco {
  produto_id: string;
  nome: string;
  margem_bps: number;
  margem_percentual: number;
  meta_bps: number;
  meta_percentual: number;
  preco_medio_venda_centavos: number;
  custo_compra_mais_recente_centavos: number;
  unidades_7_dias: number;
  /** Alta do giro; nula quando o produto não vendeu nos 28 dias anteriores. */
  alta_bps: number | null;
  alta_percentual: number | null;
}

export interface EntradaEspacoParaSubirPreco {
  giro: ResultadoMetrica<Giro>;
  margens: ReadonlyArray<{ produto_id: string; resultado: ResultadoMetrica<MargemDoProduto> | DadoAusente }>;
}

/**
 * Produtos de giro alto com margem abaixo da meta. Produto de giro alto sem margem calculável
 * (sem custo ou sem venda) fica de fora: sem margem não há como dizer que está abaixo da meta.
 */
export function calcularEspacoParaSubirPreco(
  entrada: EntradaEspacoParaSubirPreco,
): ResultadoMetrica<ProdutoComEspacoParaSubirPreco[]> {
  const { giro } = entrada;
  const giroPorProduto = new Map(giro.valor.por_produto.map((g) => [g.produto_id, g]));
  const margemPorProduto = new Map(entrada.margens.map((m) => [m.produto_id, m.resultado]));

  const produtos: ProdutoComEspacoParaSubirPreco[] = [];
  const fontes: Procedencia[] = [procedenciaDe(giro)];
  for (const id of giro.valor.giro_alto) {
    const margem = margemPorProduto.get(id);
    const g = giroPorProduto.get(id);
    if (!margem || ehDadoAusente(margem) || !g || !margem.valor.abaixo_da_meta) continue;
    produtos.push({
      produto_id: id,
      nome: margem.valor.nome,
      margem_bps: margem.valor.margem_bps,
      margem_percentual: margem.valor.margem_percentual,
      meta_bps: margem.valor.meta_bps,
      meta_percentual: margem.valor.meta_percentual,
      preco_medio_venda_centavos: margem.valor.preco_medio_venda_centavos,
      custo_compra_mais_recente_centavos: margem.valor.custo_compra_mais_recente_centavos,
      unidades_7_dias: g.unidades_7_dias,
      alta_bps: g.alta_bps,
      alta_percentual: g.alta_percentual,
    });
    fontes.push(procedenciaDe(margem));
  }

  produtos.sort((a, b) => compararNomes(a.nome, b.nome) || compararTexto(a.produto_id, b.produto_id));
  return resultadoMetrica(produtos, giro.periodo, fontes);
}
