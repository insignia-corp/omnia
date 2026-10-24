import { z } from "zod";
import { mesclarLimites, type FonteDeLimites } from "../../../alertas/limites";
import { somarDias } from "../../../lib/datas/datas";
import { PARAMETROS_ATENCAO } from "../../../metricas/atencao";
import type { BriefingDiario } from "../../../metricas/briefing-diario";
import type { MetricasService } from "../../../metricas/metricas.service";
import { definirFerramenta } from "../ferramenta";

/**
 * Resumo diário do pitch: o dia (ontem, sem data) contra a média dos mesmos dias da semana nas 3
 * semanas anteriores, os 3 mais vendidos e os 3 piores dos 7 dias até o dia e até 3 produtos que
 * precisam de atenção. Devolve o resultado como a métrica montou; bloco sem dado vem como dado
 * ausente, nunca zero. O limite de reajuste do custo é o do comerciante (issue #147).
 */
export function criarGetDailyBriefing(metricas: MetricasService, limites: FonteDeLimites) {
  return definirFerramenta({
    nome: "get_daily_briefing",
    descricao:
      "Resumo diário do comércio para a mensagem da manhã e para perguntas sobre o faturamento, as vendas ou o " +
      "ticket médio de um dia. Sem data, resume ontem (o último dia com vendas completas). Traz: o dia (faturamento, " +
      "vendas e ticket médio) contra a média dos mesmos dias da semana nas 3 semanas anteriores (ex.: a sexta " +
      "contra as 3 sextas anteriores), com variacao_faturamento_percentual e variacao_ticket_percentual; os 3 mais " +
      "vendidos em unidades nos 7 dias até o dia; os 3 piores (maior queda em unidades contra os 7 dias anteriores); " +
      "e até 3 produtos que precisam de atenção, com o motivo: custo_subiu (última compra mais cara que a anterior), " +
      "margem_abaixo_da_meta ou sem_venda (dias sem vender). Use para 'qual foi o ticket médio de ontem' e para o " +
      "resumo do dia. Blocos sem dado vêm como dado ausente (ausente: true): diga isso ao dono, não estime. Traz " +
      "período, número de registros, menor confiança e origem.",
    entrada: z.strictObject({
      data: z.iso.date().optional().describe("Dia a resumir (AAAA-MM-DD). Omita para resumir ontem."),
    }),
    efeito: "nenhum",
    async executar(contexto, { data }): Promise<BriefingDiario> {
      // O comerciante vem da sessão (regra inviolável 3), e o limite de reajuste é o que ele ajustou.
      const doComerciante = mesclarLimites(await limites.limitesDoComerciante(contexto.comercianteId));
      return metricas.briefingDiario(contexto, data ?? somarDias(contexto.dataReferencia, -1), {
        ...PARAMETROS_ATENCAO,
        limiteReajusteBps: doComerciante.reajusteLimiteBps,
      });
    },
  });
}
