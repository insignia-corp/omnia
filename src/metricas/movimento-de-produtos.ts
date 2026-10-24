/**
 * Mais vendidos e piores da semana (resumo diário do pitch): unidades nos 7 dias até a data e,
 * para os piores, a queda contra os 7 dias anteriores. "Pior" é o que mais caiu em unidades, só
 * entre os que tinham volume para cair: queda sobre pouco volume não é sinal.
 */
import { somarDias } from "../lib/datas/datas";
import {
  compararNomes,
  compararTexto,
  procedenciaDoProduto,
  type IntervaloDeDados,
  type ProdutoParaMetrica,
  type VendaDoProdutoNoDia,
} from "./dados-de-metricas";
import { percentualDeBps, razaoEmBps } from "./pontos-base";
import { arredondarQuantidade, somarQuantidades } from "./quantidades";
import {
  dadoAusente,
  resultadoMetrica,
  type DadoAusente,
  type Periodo,
  type ResultadoMetrica,
} from "./resultado-metrica";

/** A janela faz parte da definição da métrica e dos nomes dos campos; os demais valores são ajustáveis. */
export const DIAS_DA_JANELA_DE_PRODUTOS = 7;
const DIAS_DA_JANELA = DIAS_DA_JANELA_DE_PRODUTOS;

/** Quantos dias de venda, até a data, os piores precisam (a semana e a anterior). */
export const DIAS_DE_HISTORICO_DOS_PIORES = 2 * DIAS_DA_JANELA;

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_MAIS_VENDIDOS = { topN: 3 } as const;
export type ParametrosMaisVendidos = { readonly topN: number };

export const PARAMETROS_PIORES = { topN: 3, minimoUnidadesAnteriores: 10 } as const;
export type ParametrosPiores = { readonly topN: number; readonly minimoUnidadesAnteriores: number };

export interface ProdutoMaisVendido {
  produto_id: string;
  produto: string;
  unidades_7_dias: number;
}

export interface ProdutoEmQueda {
  produto_id: string;
  produto: string;
  unidades_7_dias: number;
  unidades_7_dias_anteriores: number;
  /** Negativa: (semana - semana anterior) / semana anterior. */
  variacao_bps: number;
  variacao_percentual: number;
}

export interface EntradaMovimentoDeProdutos {
  produtos: readonly ProdutoParaMetrica[];
  /** Vendas de qualquer produto e dia: a função recorta as janelas. */
  vendas: readonly VendaDoProdutoNoDia[];
  /** Datas entre as quais há venda importada; dia fora delas é dia sem dado, não dia sem venda. */
  intervaloDeVendas: IntervaloDeDados | null;
  data: string;
}

const janela = (fim: string): Periodo => ({ inicio: somarDias(fim, -(DIAS_DA_JANELA - 1)), fim });
const dentro = (data: string, periodo: Periodo): boolean => data >= periodo.inicio && data <= periodo.fim;
const cobre = (intervalo: IntervaloDeDados | null, periodo: Periodo): boolean =>
  intervalo !== null && intervalo.primeira <= periodo.inicio && intervalo.ultima >= periodo.fim;

function semCobertura(periodo: Periodo): DadoAusente {
  return dadoAusente(
    "historico_insuficiente",
    `É preciso ter vendas importadas de ${periodo.inicio} a ${periodo.fim} e a base não cobre esse período.`,
    "Pode enviar a planilha de vendas das últimas 2 semanas?",
  );
}

/** Unidades de cada produto conhecido na janela, com as vendas usadas. */
function unidadesNa(
  entrada: EntradaMovimentoDeProdutos,
  periodo: Periodo,
): { unidades: Map<string, number>; usadas: VendaDoProdutoNoDia[] } {
  const conhecidos = new Set(entrada.produtos.map((p) => p.id));
  const porProduto = new Map<string, number[]>();
  const usadas: VendaDoProdutoNoDia[] = [];
  for (const venda of entrada.vendas) {
    if (!conhecidos.has(venda.produtoId) || !dentro(venda.data, periodo)) continue;
    porProduto.set(venda.produtoId, [...(porProduto.get(venda.produtoId) ?? []), venda.quantidade]);
    usadas.push(venda);
  }
  const unidades = new Map([...porProduto].map(([id, qs]) => [id, somarQuantidades(qs)]));
  return { unidades, usadas };
}

const desempate = (
  a: { produto: string; produto_id: string },
  b: { produto: string; produto_id: string },
): number => compararNomes(a.produto, b.produto) || compararTexto(a.produto_id, b.produto_id);

/** Os mais vendidos em unidades nos 7 dias até a data. Dado ausente se as vendas não cobrem a janela. */
export function calcularMaisVendidos(
  entrada: EntradaMovimentoDeProdutos,
  parametros: ParametrosMaisVendidos = PARAMETROS_MAIS_VENDIDOS,
): ResultadoMetrica<ProdutoMaisVendido[]> | DadoAusente {
  const periodo = janela(entrada.data);
  if (!cobre(entrada.intervaloDeVendas, periodo)) return semCobertura(periodo);

  const { unidades, usadas } = unidadesNa(entrada, periodo);
  const ranking = entrada.produtos
    .map((p) => ({ produto_id: p.id, produto: p.nome, unidades_7_dias: unidades.get(p.id) ?? 0 }))
    .filter((p) => p.unidades_7_dias > 0)
    .sort((a, b) => b.unidades_7_dias - a.unidades_7_dias || desempate(a, b))
    .slice(0, parametros.topN);
  return resultadoMetrica(ranking, periodo, [...usadas, ...entrada.produtos.map(procedenciaDoProduto)]);
}

/**
 * As maiores quedas em unidades nos 7 dias até a data contra os 7 anteriores, só de produtos com
 * o mínimo de unidades na semana anterior e que caíram. Dado ausente se as vendas não cobrem as
 * duas semanas: semana sem dado contada como zero inventaria uma queda.
 */
export function calcularPiores(
  entrada: EntradaMovimentoDeProdutos,
  parametros: ParametrosPiores = PARAMETROS_PIORES,
): ResultadoMetrica<ProdutoEmQueda[]> | DadoAusente {
  const recente = janela(entrada.data);
  const anterior = janela(somarDias(entrada.data, -DIAS_DA_JANELA));
  const periodo: Periodo = { inicio: anterior.inicio, fim: recente.fim };
  if (!cobre(entrada.intervaloDeVendas, periodo)) return semCobertura(periodo);

  const daSemana = unidadesNa(entrada, recente);
  const daAnterior = unidadesNa(entrada, anterior);
  const quedas: ProdutoEmQueda[] = [];
  for (const p of entrada.produtos) {
    const agora = daSemana.unidades.get(p.id) ?? 0;
    const antes = daAnterior.unidades.get(p.id) ?? 0;
    if (antes < parametros.minimoUnidadesAnteriores || agora >= antes) continue;
    const variacao = razaoEmBps(arredondarQuantidade(agora - antes), antes) ?? 0;
    quedas.push({
      produto_id: p.id,
      produto: p.nome,
      unidades_7_dias: agora,
      unidades_7_dias_anteriores: antes,
      variacao_bps: variacao,
      variacao_percentual: percentualDeBps(variacao),
    });
  }
  const queda = (q: ProdutoEmQueda): number =>
    arredondarQuantidade(q.unidades_7_dias_anteriores - q.unidades_7_dias);
  quedas.sort((a, b) => queda(b) - queda(a) || a.variacao_bps - b.variacao_bps || desempate(a, b));
  return resultadoMetrica(quedas.slice(0, parametros.topN), periodo, [
    ...daSemana.usadas,
    ...daAnterior.usadas,
    ...entrada.produtos.map(procedenciaDoProduto),
  ]);
}
