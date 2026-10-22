/**
 * Ciclo de vida do alerta depois do motor (issue #155): grava os status finais `enviado` e
 * `descartado` para a supressão de 7 dias funcionar de ponta a ponta. O motor só cria `candidato`.
 * Nada é apagado (regra inviolável 10): a linha muda de status e ganha a data, a execução e a
 * justificativa. Toda consulta e toda escrita é do comerciante da sessão (regra inviolável 3), e só
 * sai de `candidato`: um alerta já enviado ou descartado nunca volta atrás.
 */
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../infra/database/database.module";
import { alerta, chamadaFerramenta, execucaoAgente, mensagem } from "../infra/database/schema";

/** O que `select_alerts` registra na entrada da chamada: os candidatos escolhidos e a justificativa. */
const escolhaDoAgente = z.object({
  alertas: z.array(z.object({ alerta_id: z.uuid(), justificativa: z.string() })),
});

export class CicloDoAlerta {
  constructor(private readonly db: Executor) {}

  /**
   * Marca como `enviado` os alertas que o agente escolheu na execução `execucaoId`, depois que a
   * mensagem foi entregue. Considera só chamadas de `select_alerts` que deram certo. Devolve quantos
   * alertas mudaram de `candidato` para `enviado` (zero numa repetição).
   */
  async marcarEnviados(
    comercianteId: string,
    execucaoId: string,
    enviadoEm: Date = new Date(),
  ): Promise<number> {
    // Só vale a execução cuja mensagem o dono de fato recebeu com os alertas: num fallback (verificador
    // barrou, erro, recusa) o texto não traz os alertas escolhidos, e marcá-los os suprimiria por 7 dias.
    const [execucao] = await this.db
      .select({ resultado: execucaoAgente.resultado })
      .from(execucaoAgente)
      .where(and(eq(execucaoAgente.id, execucaoId), eq(execucaoAgente.comercianteId, comercianteId)));
    if (execucao?.resultado !== "aprovada") return 0;

    const chamadas = await this.db
      .select({ entrada: chamadaFerramenta.entrada })
      .from(chamadaFerramenta)
      .where(
        and(
          eq(chamadaFerramenta.comercianteId, comercianteId),
          eq(chamadaFerramenta.execucaoId, execucaoId),
          eq(chamadaFerramenta.ferramenta, "select_alerts"),
          isNull(chamadaFerramenta.erro),
        ),
      )
      .orderBy(asc(chamadaFerramenta.ordem));
    // A escolha final do agente é a última chamada bem-sucedida: cada chamada respeita o teto de 3 e
    // somar várias passaria dele.
    const escolhas = chamadas.flatMap((c) => {
      const entrada = escolhaDoAgente.safeParse(c.entrada);
      return entrada.success ? [entrada.data.alertas] : [];
    });
    const escolhidos = new Map((escolhas.at(-1) ?? []).map((a) => [a.alerta_id, a.justificativa]));
    if (escolhidos.size === 0) return 0;

    let marcados = 0;
    for (const [alertaId, justificativa] of escolhidos) {
      const linhas = await this.db
        .update(alerta)
        .set({ status: "enviado", enviadoEm, execucaoId, justificativa })
        .where(
          and(
            eq(alerta.id, alertaId),
            eq(alerta.comercianteId, comercianteId),
            eq(alerta.status, "candidato"),
          ),
        )
        .returning({ id: alerta.id });
      marcados += linhas.length;
    }
    return marcados;
  }

  /**
   * Recupera a marcação quando o processo caiu entre entregar a mensagem do dia e marcar: pega a
   * execução da mensagem proativa **entregue** (com id externo) em `dataEnvio` e marca os alertas dela. Idempotente.
   */
  async reconciliar(comercianteId: string, dataEnvio: string, enviadoEm: Date = new Date()): Promise<number> {
    const mensagens = await this.db
      .select({ execucaoId: mensagem.execucaoId })
      .from(mensagem)
      .where(
        and(
          eq(mensagem.comercianteId, comercianteId),
          eq(mensagem.dataEnvio, dataEnvio),
          eq(mensagem.proativa, true),
          eq(mensagem.direcao, "enviada"),
          // Entrega confirmada: a linha é gravada antes do envio e só ganha o id externo depois dele.
          // Sem ele não se sabe se a mensagem saiu, e marcar suprimiria alertas que o dono não viu.
          isNotNull(mensagem.idExterno),
        ),
      );
    let marcados = 0;
    for (const m of mensagens) {
      if (m.execucaoId) marcados += await this.marcarEnviados(comercianteId, m.execucaoId, enviadoEm);
    }
    return marcados;
  }

  /**
   * Marca como `descartado` um candidato que o dono dispensou, com a justificativa. Ainda não há
   * quem chame: o MVP não tem fluxo de descarte pelo dono. Devolve se a linha mudou.
   */
  async descartar(comercianteId: string, alertaId: string, justificativa: string): Promise<boolean> {
    const linhas = await this.db
      .update(alerta)
      .set({ status: "descartado", justificativa })
      .where(
        and(eq(alerta.id, alertaId), eq(alerta.comercianteId, comercianteId), eq(alerta.status, "candidato")),
      )
      .returning({ id: alerta.id });
    return linhas.length > 0;
  }
}
