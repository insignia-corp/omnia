import { z } from "zod";
import { somarDias } from "../../../lib/datas/datas";
import type { MetricasService } from "../../../metricas/metricas.service";
import { definirFerramenta } from "../ferramenta";

/**
 * Resumo de um dia (issue #50): faturamento, gastos, saldo e comparação com os dias anteriores.
 * Devolve o resultado da métrica como veio. Gastos e saldo do dia podem ser dado ausente (sem
 * extrato para o dia): a ferramenta repassa, nunca troca por zero.
 */
export function criarGetDailySummary(metricas: MetricasService) {
  return definirFerramenta({
    nome: "get_daily_summary",
    descricao:
      "Resumo de um dia do comércio: faturamento, número de cupons, ticket médio, gastos, saldo do dia, " +
      "saldo da conta e comparação do faturamento com o dia anterior, o mesmo dia da semana anterior e a " +
      "média dos 7 dias anteriores. Sem data, resume ontem (o dia anterior à data de referência), o último dia " +
      "com vendas completas: o dia de hoje ainda não conta. Para outro dia passado, passe a data. Gastos, saldo e " +
      "comparações podem vir como dado ausente (ausente: true) quando faltam extrato ou histórico: " +
      "diga isso ao dono, não estime. Cada resultado traz período, número de registros, menor confiança e origem.",
    entrada: z.strictObject({
      data: z.iso.date().optional().describe("Dia a resumir (AAAA-MM-DD). Omita para resumir ontem."),
    }),
    efeito: "nenhum",
    // Ontem é o último dia completo (a data de referência ainda não tem vendas importadas); a `data` explícita vale como veio.
    executar: (contexto, { data }) =>
      metricas.resumoDiario(contexto, data ?? somarDias(contexto.dataReferencia, -1)),
  });
}
