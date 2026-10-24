/**
 * Produtos que precisam de atenção (resumo diário do pitch): até 3, um por produto, nesta ordem de
 * motivo: o custo subiu na última compra, a margem está abaixo da meta, o produto parou de vender.
 * Junta resultados de métricas que já existem (variação de custo, margem e última venda); aqui só
 * se escolhe e se ordena.
 */
import { diasEntre, somarDias } from "../lib/datas/datas";
import {
  compararNomes,
  compararTexto,
  procedenciaDoProduto,
  type ProdutoParaMetrica,
  type UltimaVendaDoProduto,
} from "./dados-de-metricas";
import type { MargemDoProduto } from "./margem-por-produto";
import { PARAMETROS_VARIACAO_CUSTO, type VariacaoDeCusto } from "./variacao-de-custo";
import {
  ehDadoAusente,
  procedenciaDe,
  resultadoMetrica,
  type DadoAusente,
  type Procedencia,
  type ResultadoMetrica,
} from "./resultado-metrica";

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_ATENCAO = {
  topN: 3,
  /** A compra que subiu o custo tem de ser destes últimos dias, contando a data. */
  janelaCompraDias: 7,
  /** Alta acima disto, quando o comerciante não ajustou o próprio limite de reajuste. */
  limiteReajusteBps: PARAMETROS_VARIACAO_CUSTO.limiteBps,
  minimoDiasSemVenda: 14,
} as const;
export type ParametrosAtencao = {
  readonly topN: number;
  readonly janelaCompraDias: number;
  readonly limiteReajusteBps: number;
  readonly minimoDiasSemVenda: number;
};

export type ProdutoEmAtencao =
  | {
      produto_id: string;
      produto: string;
      motivo: "custo_subiu";
      custo_anterior_centavos: number;
      custo_atual_centavos: number;
      variacao_percentual: number;
      data_compra: string;
    }
  | {
      produto_id: string;
      produto: string;
      motivo: "margem_abaixo_da_meta";
      margem_percentual: number;
      meta_percentual: number;
    }
  | {
      produto_id: string;
      produto: string;
      motivo: "sem_venda";
      dias_sem_venda: number;
      ultima_venda: string;
    };

export interface EntradaAtencao {
  data: string;
  produtos: readonly ProdutoParaMetrica[];
  /** `calcularVariacoesDeCusto` com referência na data. */
  variacoesDeCusto: ResultadoMetrica<VariacaoDeCusto[]>;
  /** Margem de cada produto com referência na data; a do produto sem venda ou sem custo vem como dado ausente. */
  margens: ReadonlyArray<ResultadoMetrica<MargemDoProduto> | DadoAusente>;
  /** A última venda de cada produto até a data, na base inteira. */
  ultimasVendas: readonly UltimaVendaDoProduto[];
}

interface Candidato {
  item: ProdutoEmAtencao;
  fontes: Procedencia[];
  /** Primeiro dia dos dados que sustentam o motivo, para o período do resultado. */
  inicio: string;
}

/** Até `topN` produtos, um por produto: primeiro custo que subiu, depois margem abaixo da meta, depois sem venda. */
export function calcularAtencao(
  entrada: EntradaAtencao,
  parametros: ParametrosAtencao = PARAMETROS_ATENCAO,
): ResultadoMetrica<ProdutoEmAtencao[]> {
  const { data } = entrada;
  const produtoPorId = new Map(entrada.produtos.map((p) => [p.id, p]));
  const inicioDaCompra = somarDias(data, -(parametros.janelaCompraDias - 1));
  const porNome = (a: Candidato, b: Candidato): number =>
    compararNomes(a.item.produto, b.item.produto) || compararTexto(a.item.produto_id, b.item.produto_id);

  // A variação já vem da maior alta para a maior queda; a confiança de cada uma é a das duas compras.
  const custoSubiu: Candidato[] = entrada.variacoesDeCusto.valor
    .filter(
      (v) =>
        v.variacao_bps > parametros.limiteReajusteBps &&
        v.compra_atual_data >= inicioDaCompra &&
        v.compra_atual_data <= data,
    )
    .map((v) => ({
      item: {
        produto_id: v.produto_id,
        produto: v.nome,
        motivo: "custo_subiu",
        custo_anterior_centavos: v.custo_anterior_centavos,
        custo_atual_centavos: v.custo_atual_centavos,
        variacao_percentual: v.variacao_percentual,
        data_compra: v.compra_atual_data,
      },
      fontes: [
        {
          registros: 2,
          menorConfianca: v.menor_confianca,
          origens: entrada.variacoesDeCusto.origens,
        },
      ],
      inicio: v.compra_anterior_data,
    }));

  const margemAbaixo: Candidato[] = entrada.margens
    .flatMap((m) => (ehDadoAusente(m) || !m.valor.abaixo_da_meta ? [] : [m]))
    .sort((a, b) => a.valor.margem_bps - b.valor.margem_bps || compararNomes(a.valor.nome, b.valor.nome))
    .map((m) => ({
      item: {
        produto_id: m.valor.produto_id,
        produto: m.valor.nome,
        motivo: "margem_abaixo_da_meta",
        margem_percentual: m.valor.margem_percentual,
        meta_percentual: m.valor.meta_percentual,
      },
      fontes: [procedenciaDe(m)],
      inicio: m.periodo.inicio,
    }));

  const semVenda: Candidato[] = entrada.ultimasVendas
    .filter((v) => v.data <= data && produtoPorId.has(v.produtoId))
    .map((v) => ({ venda: v, dias: diasEntre(v.data, data) }))
    .filter(({ dias }) => dias >= parametros.minimoDiasSemVenda)
    .map(({ venda, dias }): Candidato => {
      const produto = produtoPorId.get(venda.produtoId) as ProdutoParaMetrica;
      return {
        item: {
          produto_id: produto.id,
          produto: produto.nome,
          motivo: "sem_venda",
          dias_sem_venda: dias,
          ultima_venda: venda.data,
        },
        fontes: [venda, procedenciaDoProduto(produto)],
        inicio: venda.data,
      };
    })
    .sort(
      (a, b) =>
        (b.item.motivo === "sem_venda" ? b.item.dias_sem_venda : 0) -
          (a.item.motivo === "sem_venda" ? a.item.dias_sem_venda : 0) || porNome(a, b),
    );

  const escolhidos: Candidato[] = [];
  const vistos = new Set<string>();
  for (const candidato of [...custoSubiu, ...margemAbaixo, ...semVenda]) {
    if (escolhidos.length >= parametros.topN) break;
    if (vistos.has(candidato.item.produto_id)) continue;
    vistos.add(candidato.item.produto_id);
    escolhidos.push(candidato);
  }

  const inicio = escolhidos.map((c) => c.inicio).sort(compararTexto)[0] ?? data;
  return resultadoMetrica(
    escolhidos.map((c) => c.item),
    { inicio, fim: data },
    escolhidos.flatMap((c) => c.fontes),
  );
}
