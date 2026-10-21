import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../../infra/database/database.module";
import { alerta } from "../../infra/database/schema";
import { definirFerramenta } from "./ferramenta";

/** Teto de alertas por mensagem diária (regra do produto, `docs/alertas-hackathon.md`). */
export const MAX_ALERTAS_POR_DIA = 3;

/**
 * Registra a escolha dos alertas do dia e a justificativa de cada um. Não grava nada: a decisão
 * fica em `chamada_ferramenta`, na ordem, e aparece na tela de bastidores (#77). Devolve só dados do
 * banco: as métricas de apoio de cada alerta escolhido são a fonte dos números da mensagem.
 *
 * Os ids são conferidos contra os candidatos do comerciante da sessão na data da execução: o
 * modelo não consegue escolher alerta de outro lojista nem de outro dia.
 */
export function criarSelectAlerts(db: Executor) {
  return definirFerramenta({
    nome: "select_alerts",
    descricao:
      `Escolhe, entre os candidatos de list_alert_candidates, até ${MAX_ALERTAS_POR_DIA} alertas para a mensagem do dia, ` +
      "do mais importante ao menos importante, com uma justificativa curta de por que este e não os outros. " +
      "Chame antes de escrever o relatório. Devolve os dados de cada alerta escolhido; use só esses números na mensagem.",
    entrada: z
      .strictObject({
        alertas: z
          .array(
            z.strictObject({
              alerta_id: z.uuid().describe("Id do candidato, como veio em list_alert_candidates"),
              justificativa: z.string().trim().min(1).max(240),
            }),
          )
          .min(1)
          .max(MAX_ALERTAS_POR_DIA),
      })
      .refine((e) => new Set(e.alertas.map((a) => a.alerta_id)).size === e.alertas.length, {
        message: "Há alerta repetido na escolha",
      }),
    efeito: "nenhum",
    async executar(contexto, entrada) {
      const ids = entrada.alertas.map((a) => a.alerta_id);
      const linhas = await db
        .select()
        .from(alerta)
        .where(
          and(
            eq(alerta.comercianteId, contexto.comercianteId),
            eq(alerta.dataReferencia, contexto.dataReferencia),
            eq(alerta.status, "candidato"),
            inArray(alerta.id, ids),
          ),
        );
      const porId = new Map(linhas.map((l) => [l.id, l]));
      const faltando = ids.filter((id) => !porId.has(id));
      if (faltando.length > 0) {
        throw new Error(
          `Não são candidatos de hoje: ${faltando.join(", ")}. Use os ids de list_alert_candidates.`,
        );
      }
      const selecionados = entrada.alertas.map((a, i) => {
        const l = porId.get(a.alerta_id)!;
        return {
          ordem: i + 1,
          alerta_id: l.id,
          tipo: l.tipo,
          prioridade: l.prioridade,
          produto_id: l.produtoId,
          metricas_apoio: l.metricasApoio,
          // A justificativa é texto do modelo: fica só na entrada da chamada (bastidores). Se voltasse
          // na saída, qualquer número escrito nela passaria a valer como fonte no verificador.
        };
      });
      return { selecionados, menor_confianca: menorConfianca(selecionados.map((s) => s.metricas_apoio)) };
    },
  });
}

/** Menor `menor_confianca` entre as métricas de apoio; nulo quando nenhuma informa. */
function menorConfianca(metricas: unknown[]): number | null {
  const valores = metricas.flatMap((m) =>
    m && typeof m === "object" && "menor_confianca" in m && typeof m.menor_confianca === "number"
      ? [m.menor_confianca]
      : [],
  );
  return valores.length > 0 ? Math.min(...valores) : null;
}
