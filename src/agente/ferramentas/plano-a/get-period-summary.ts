import { z } from "zod";
import { somarDias } from "../../../lib/datas/datas";
import type { MetricasService } from "../../../metricas/metricas.service";
import { definirFerramenta } from "../ferramenta";

/**
 * Resumo da semana ou do mês (issue #182): faturamento, cupons, ticket médio, gastos e saldo do
 * período, comparado com o período anterior equivalente. Devolve o resultado da métrica como veio:
 * gastos, saldo e comparação podem ser dado ausente, e a ferramenta nunca troca por zero.
 */
export function criarGetPeriodSummary(metricas: MetricasService) {
  return definirFerramenta({
    nome: "get_period_summary",
    descricao:
      "Resumo de um período do comércio: faturamento, número de cupons, ticket médio, gastos e saldo, e a " +
      "comparação do faturamento com o período anterior. periodo 'semana' são os 7 dias que terminam em `ate`, " +
      "comparados com os 7 dias antes deles; 'mes' vai do dia 1 do mês de `ate` até `ate`, comparado com os " +
      "mesmos dias do mês anterior. Sem `ate`, o período termina ontem (o dia anterior à data de referência), o " +
      "último dia com vendas completas: o dia de hoje ainda não conta. Período com algum dia " +
      "sem vendas importadas, gastos sem extrato e comparação sem histórico vêm como dado ausente " +
      "(ausente: true): diga isso ao dono, não estime. Traz período, número de registros, menor confiança e origem.",
    entrada: z.strictObject({
      periodo: z.enum(["semana", "mes"]).describe("semana (7 dias) ou mes (do dia 1 até `ate`)"),
      ate: z.iso.date().optional().describe("Último dia do período (AAAA-MM-DD). Omita para terminar ontem."),
    }),
    efeito: "nenhum",
    // Ontem é o último dia completo (a data de referência ainda não tem vendas importadas); o `ate` explícito vale como veio.
    executar: (contexto, { periodo, ate }) =>
      metricas.resumoDePeriodo(contexto, periodo, ate ?? somarDias(contexto.dataReferencia, -1)),
  });
}
