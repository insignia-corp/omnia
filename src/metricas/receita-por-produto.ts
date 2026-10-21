/**
 * Receita por produto (issue #148): quanto cada produto faturou nos últimos 7 dias, com o ranking
 * dos de maior receita. Soma de centavos inteiros (regra inviolável 2). Fórmula e limites em
 * docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
 */
import { somarDias } from "../lib/datas/datas";
import { ZERO, centavos, somar, type Centavos } from "../lib/dinheiro/dinheiro";
import {
  compararNomes,
  compararTexto,
  type IntervaloDeDados,
  type ProdutoParaMetrica,
  type VendaDoProdutoNoDia,
} from "./dados-de-metricas";
import {
  dadoAusente,
  resultadoMetrica,
  type DadoAusente,
  type Periodo,
  type ResultadoMetrica,
} from "./resultado-metrica";

/** A janela faz parte da definição da métrica; o tamanho do ranking é ajustável. */
export const DIAS_DA_RECEITA = 7;
export const PARAMETROS_RECEITA = { topN: 5 } as const;
export type ParametrosReceita = { readonly topN: number };

export interface ReceitaDoProduto {
  produto_id: string;
  nome: string;
  receita_centavos: number;
}

export interface ReceitaPorProduto {
  periodo: Periodo;
  por_produto: ReceitaDoProduto[];
  /** Os de maior receita na janela, só com receita maior que zero. */
  maior_receita: ReceitaDoProduto[];
}

export interface EntradaReceitaPorProduto {
  produtos: readonly ProdutoParaMetrica[];
  /** Vendas de qualquer produto e dia: a função recorta a janela. */
  vendas: readonly VendaDoProdutoNoDia[];
  /** Datas entre as quais há venda importada; dia fora delas é dia sem dado, não dia sem venda. */
  intervaloDeVendas: IntervaloDeDados | null;
  dataReferencia: string;
}

/**
 * Receita de cada produto nos 7 dias até a data de referência. Devolve dado ausente enquanto as
 * vendas importadas não cobrirem a janela: dia sem dado contado como receita zero inventaria um
 * ranking. Desempate pelo nome em ordem alfabética do português e depois pelo id.
 */
export function calcularReceitaPorProduto(
  entrada: EntradaReceitaPorProduto,
  parametros: ParametrosReceita = PARAMETROS_RECEITA,
): ResultadoMetrica<ReceitaPorProduto> | DadoAusente {
  const ref = entrada.dataReferencia;
  const periodo: Periodo = { inicio: somarDias(ref, -(DIAS_DA_RECEITA - 1)), fim: ref };

  const intervalo = entrada.intervaloDeVendas;
  if (!intervalo || intervalo.primeira > periodo.inicio || intervalo.ultima < ref) {
    return dadoAusente(
      "historico_insuficiente",
      `A receita por produto precisa de vendas importadas de ${periodo.inicio} a ${ref} (${DIAS_DA_RECEITA} dias) e a base não cobre esse período.`,
      "Pode enviar a planilha de vendas da última semana?",
    );
  }

  const conhecidos = new Set(entrada.produtos.map((p) => p.id));
  const receitas = new Map<string, Centavos[]>();
  const usadas: VendaDoProdutoNoDia[] = [];
  for (const venda of entrada.vendas) {
    if (!conhecidos.has(venda.produtoId) || venda.data < periodo.inicio || venda.data > periodo.fim) continue;
    receitas.set(venda.produtoId, [
      ...(receitas.get(venda.produtoId) ?? []),
      centavos(venda.receitaCentavos),
    ]);
    usadas.push(venda);
  }

  const desempate = (a: ReceitaDoProduto, b: ReceitaDoProduto): number =>
    compararNomes(a.nome, b.nome) || compararTexto(a.produto_id, b.produto_id);
  const porProduto: ReceitaDoProduto[] = entrada.produtos
    .map((produto) => ({
      produto_id: produto.id,
      nome: produto.nome,
      receita_centavos: somar(...(receitas.get(produto.id) ?? [ZERO])),
    }))
    .sort(desempate);
  const maiorReceita = porProduto
    .filter((r) => r.receita_centavos > 0)
    .sort((a, b) => b.receita_centavos - a.receita_centavos || desempate(a, b))
    .slice(0, parametros.topN);

  return resultadoMetrica<ReceitaPorProduto>(
    { periodo, por_produto: porProduto, maior_receita: maiorReceita },
    periodo,
    usadas,
  );
}
