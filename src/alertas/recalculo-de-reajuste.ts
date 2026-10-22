/**
 * Recalculo do reajuste de custo gravado (issue #186). A regra de reajuste só enxerga a compra atual
 * do par produto e fornecedor: uma nota nova no dia, a reemissão das leituras de uma nota ou a
 * correção da nota anterior fazem a alta do candidato de uma compra sumir da regra sem ter sido
 * refutada. Aqui a variação da própria compra do alerta (`compra_atual_id`) é refeita com as leituras
 * vigentes, na ordem da métrica (`compararCustos`): a anterior é a última leitura de outra compra que
 * vem antes dela. Função pura, sem acesso a banco.
 */
import { centavos, ErroDinheiro, multiplicar } from "../lib/dinheiro/dinheiro";
import { compararCustos, type CustoDeCompra } from "../metricas/dados-de-metricas";
import { percentualDeBps, razaoEmBps } from "../metricas/pontos-base";
import type { LimitesDeAlerta } from "./limites";
import { prioridadeDe } from "./prioridade";
import type { Prioridade } from "./tipos";

export type ReajusteRecalculado =
  /** A compra não tem mais leitura vigente (ex.: exclusão a pedido do lojista): não dá para dizer, fica como está. */
  | { situacao: "sem_dado" }
  /** Sem compra anterior, sem variação ou alta no limite ou abaixo dele: o alerta deixou de valer. */
  | { situacao: "desfeito" }
  /** A alta continua acima do limite: números e prioridade refeitos com as leituras vigentes. */
  | { situacao: "vale"; metricasApoio: Record<string, unknown>; prioridade: Prioridade };

export interface EntradaDoRecalculo {
  /** `metricas_apoio` do alerta gravado. */
  metricasApoio: Record<string, unknown>;
  /** Leituras vigentes do par produto e fornecedor do alerta, até a data de referência. */
  custos: readonly CustoDeCompra[];
  /** Confiança do cadastro do produto, que a métrica também considera. */
  confiancaDoProduto: number;
  limites: LimitesDeAlerta;
}

const numero = (valor: unknown): number | null => (typeof valor === "number" ? valor : null);

export function recalcularReajuste(entrada: EntradaDoRecalculo): ReajusteRecalculado {
  const { metricasApoio, limites } = entrada;
  const compraId = metricasApoio.compra_atual_id;
  if (typeof compraId !== "string") return { situacao: "sem_dado" };
  const emOrdem = [...entrada.custos].sort(compararCustos);
  const posicao = emOrdem.findLastIndex((c) => c.compraId === compraId);
  if (posicao < 0) return { situacao: "sem_dado" };
  const atual = emOrdem[posicao]!;
  const anterior = emOrdem.slice(0, posicao).findLast((c) => c.compraId !== compraId);
  if (!anterior) return { situacao: "desfeito" };
  const variacaoBps = razaoEmBps(
    atual.custoUnitarioCentavos - anterior.custoUnitarioCentavos,
    anterior.custoUnitarioCentavos,
  );
  // Mesmo corte da regra: no limite ou abaixo dele não é reajuste.
  if (variacaoBps === null || variacaoBps <= limites.reajusteLimiteBps) return { situacao: "desfeito" };

  // O giro do alerta (vendas da semana) não muda com a correção do custo: vale o que foi gravado.
  const unidades = numero(metricasApoio.unidades_7_dias);
  let impacto: number | null = null;
  if (unidades !== null) {
    try {
      impacto = multiplicar(centavos(atual.custoUnitarioCentavos - anterior.custoUnitarioCentavos), unidades);
    } catch (e) {
      if (!(e instanceof ErroDinheiro)) throw e;
    }
  }
  const confianca = Math.min(atual.confianca, anterior.confianca, entrada.confiancaDoProduto);
  const doGiro = numero(
    (metricasApoio.giro_fonte as { menor_confianca?: unknown } | undefined)?.menor_confianca,
  );
  const menorConfianca = doGiro === null ? confianca : Math.min(confianca, doGiro);
  return {
    situacao: "vale",
    prioridade: prioridadeDe({ impactoCentavos: impacto, confianca: menorConfianca }, limites),
    metricasApoio: {
      ...metricasApoio,
      custo_anterior_centavos: anterior.custoUnitarioCentavos,
      custo_atual_centavos: atual.custoUnitarioCentavos,
      variacao_bps: variacaoBps,
      variacao_percentual: percentualDeBps(variacaoBps),
      compra_anterior_data: anterior.data,
      compra_atual_data: atual.data,
      impacto_centavos: impacto,
      menor_confianca: menorConfianca,
      // Procedência das leituras usadas agora (regra 4): as duas compras, não o conjunto da gravação.
      fonte: {
        periodo: { inicio: anterior.data, fim: atual.data },
        n_registros: 2,
        menor_confianca: confianca,
        origens: [...new Set([anterior.origem, atual.origem])].sort(),
      },
    },
  };
}
