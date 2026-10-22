/**
 * Ciclo de vida do alerta depois do motor (issue #155): grava os status finais `enviado` e
 * `descartado` para a supressão de 7 dias funcionar de ponta a ponta. O motor só cria `candidato`.
 * Nada é apagado (regra inviolável 10): a linha muda de status e ganha a data, a execução e a
 * justificativa. Toda consulta e toda escrita é do comerciante da sessão (regra inviolável 3), e só
 * sai de `candidato`: um alerta já enviado ou descartado nunca volta atrás.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "../infra/database/database.module";
import { alerta, chamadaFerramenta } from "../infra/database/schema";

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
      );
    const escolhidos = new Map<string, string>();
    for (const c of chamadas) {
      const entrada = escolhaDoAgente.safeParse(c.entrada);
      if (!entrada.success) continue;
      for (const a of entrada.data.alertas) escolhidos.set(a.alerta_id, a.justificativa);
    }
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

/** Ids dos alertas que mudaram de status numa execução: usado nos testes de auditoria. */
export async function alertasDaExecucao(
  db: Executor,
  comercianteId: string,
  execucaoId: string,
): Promise<string[]> {
  const linhas = await db
    .select({ id: alerta.id })
    .from(alerta)
    .where(
      and(
        eq(alerta.comercianteId, comercianteId),
        eq(alerta.execucaoId, execucaoId),
        inArray(alerta.status, ["enviado", "descartado"]),
      ),
    );
  return linhas.map((l) => l.id);
}
