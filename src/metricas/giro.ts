/**
 * Maior giro (issue #34): unidades vendidas nos últimos 7 dias comparadas com a média semanal
 * dos 28 dias anteriores. Sem dado de estoque, o giro é um ranking de quantidade vendida.
 * Fórmula e limites em docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
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
import { somarQuantidades } from "./quantidades";
import {
  dadoAusente,
  resultadoMetrica,
  type DadoAusente,
  type Periodo,
  type ResultadoMetrica,
} from "./resultado-metrica";

/** As janelas fazem parte da definição da métrica e dos nomes dos campos; os demais valores são ajustáveis. */
const ULTIMOS_DIAS = 7;
const ANTERIORES_DIAS = 28;
const SEMANAS_ANTERIORES = ANTERIORES_DIAS / 7;

/** Quantos dias de venda, até a data de referência, o cálculo precisa. */
export const DIAS_DE_HISTORICO_DO_GIRO = ULTIMOS_DIAS + ANTERIORES_DIAS;

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_GIRO = { minimoMediaSemanal: 14, topN: 5 } as const;
export type ParametrosGiro = { readonly minimoMediaSemanal: number; readonly topN: number };

export interface GiroDoProduto {
  produto_id: string;
  nome: string;
  unidades_7_dias: number;
  unidades_28_dias_anteriores: number;
  media_semanal_28_dias: number;
  /** Alta das últimas 7 dias sobre a média semanal anterior; nula sem venda nos 28 dias anteriores. */
  alta_bps: number | null;
  alta_percentual: number | null;
  /** A média semanal anterior chega ao mínimo, para uma alta sobre pouco volume não enganar. */
  elegivel_para_alta: boolean;
}

export interface Giro {
  periodos: { ultimos_7_dias: Periodo; anteriores_28_dias: Periodo };
  por_produto: GiroDoProduto[];
  /** Os de maior alta entre os elegíveis. */
  maior_alta: GiroDoProduto[];
  /** Os de maior volume nos últimos 7 dias. */
  maior_volume: GiroDoProduto[];
  /** Ids dos produtos que estão em `maior_alta` ou em `maior_volume`. */
  giro_alto: string[];
}

export interface EntradaGiro {
  produtos: readonly ProdutoParaMetrica[];
  /** Vendas de qualquer produto e dia: a função recorta as duas janelas. */
  vendas: readonly VendaDoProdutoNoDia[];
  /** Datas entre as quais há venda importada; dia fora delas é dia sem dado, não dia sem venda. */
  intervaloDeVendas: IntervaloDeDados | null;
  dataReferencia: string;
}

const dentro = (data: string, periodo: Periodo): boolean => data >= periodo.inicio && data <= periodo.fim;

function acumular(mapa: Map<string, number[]>, chave: string, valor: number): void {
  const lista = mapa.get(chave);
  if (lista) lista.push(valor);
  else mapa.set(chave, [valor]);
}

/**
 * Giro de todos os produtos na data de referência, com os rankings de alta e de volume. Devolve
 * dado ausente enquanto as vendas importadas não cobrirem as duas janelas: dia sem dado contado
 * como volume zero derrubaria a média e inventaria uma alta.
 */
export function calcularGiro(
  entrada: EntradaGiro,
  parametros: ParametrosGiro = PARAMETROS_GIRO,
): ResultadoMetrica<Giro> | DadoAusente {
  const ref = entrada.dataReferencia;
  const recente: Periodo = { inicio: somarDias(ref, -(ULTIMOS_DIAS - 1)), fim: ref };
  const anterior: Periodo = {
    inicio: somarDias(ref, -(ULTIMOS_DIAS + ANTERIORES_DIAS - 1)),
    fim: somarDias(ref, -ULTIMOS_DIAS),
  };

  const intervalo = entrada.intervaloDeVendas;
  if (!intervalo || intervalo.primeira > anterior.inicio || intervalo.ultima < ref) {
    return dadoAusente(
      "historico_insuficiente",
      `O giro precisa de vendas importadas de ${anterior.inicio} a ${ref} (${DIAS_DE_HISTORICO_DO_GIRO} dias) e a base não cobre esse período.`,
      "Pode enviar a planilha de vendas das últimas 5 semanas?",
    );
  }

  const conhecidos = new Set(entrada.produtos.map((p) => p.id));
  const unidadesRecentes = new Map<string, number[]>();
  const unidadesAnteriores = new Map<string, number[]>();
  const usadas: VendaDoProdutoNoDia[] = [];
  for (const venda of entrada.vendas) {
    if (!conhecidos.has(venda.produtoId)) continue;
    if (dentro(venda.data, recente)) acumular(unidadesRecentes, venda.produtoId, venda.quantidade);
    else if (dentro(venda.data, anterior)) acumular(unidadesAnteriores, venda.produtoId, venda.quantidade);
    else continue;
    usadas.push(venda);
  }

  const porProduto: GiroDoProduto[] = entrada.produtos.map((produto) => {
    const u7 = somarQuantidades(unidadesRecentes.get(produto.id) ?? []);
    const u28 = somarQuantidades(unidadesAnteriores.get(produto.id) ?? []);
    const mediaSemanal = u28 / SEMANAS_ANTERIORES;
    const altaBps = u28 > 0 ? razaoEmBps(SEMANAS_ANTERIORES * u7 - u28, u28) : null;
    return {
      produto_id: produto.id,
      nome: produto.nome,
      unidades_7_dias: u7,
      unidades_28_dias_anteriores: u28,
      media_semanal_28_dias: mediaSemanal,
      alta_bps: altaBps,
      alta_percentual: altaBps === null ? null : percentualDeBps(altaBps),
      elegivel_para_alta: mediaSemanal >= parametros.minimoMediaSemanal,
    };
  });

  const desempate = (a: GiroDoProduto, b: GiroDoProduto): number =>
    compararNomes(a.nome, b.nome) || compararTexto(a.produto_id, b.produto_id);
  const maiorAlta = porProduto
    .filter((g) => g.elegivel_para_alta && g.alta_bps !== null)
    .sort((a, b) => (b.alta_bps ?? 0) - (a.alta_bps ?? 0) || desempate(a, b))
    .slice(0, parametros.topN);
  const maiorVolume = porProduto
    .filter((g) => g.unidades_7_dias > 0)
    .sort((a, b) => b.unidades_7_dias - a.unidades_7_dias || desempate(a, b))
    .slice(0, parametros.topN);
  const giroAlto = [...new Map([...maiorAlta, ...maiorVolume].map((g) => [g.produto_id, g])).values()]
    .sort(desempate)
    .map((g) => g.produto_id);

  return resultadoMetrica<Giro>(
    {
      periodos: { ultimos_7_dias: recente, anteriores_28_dias: anterior },
      por_produto: porProduto.sort(desempate),
      maior_alta: maiorAlta,
      maior_volume: maiorVolume,
      giro_alto: giroAlto,
    },
    { inicio: anterior.inicio, fim: ref },
    [...usadas, ...entrada.produtos.map(procedenciaDoProduto)],
  );
}
