import { and, eq, sql } from "drizzle-orm";
import { intervaloDeDatas } from "../../lib/datas/datas";
import type { Executor } from "../../infra/database/database.module";
import { conta } from "../../infra/database/schema";

/**
 * Registra que a importação do extrato de uma conta terminou com sucesso no dia `data`, mesmo sem
 * transação nova. É o que o importador de extrato chama ao fim de cada sincronização: a cobertura
 * das métricas separa "sem movimento" de "sem importação" por esta data. A data nunca volta atrás
 * (uma sincronização antiga reprocessada não apaga uma mais nova), a conta tem de ser do comerciante
 * da sessão e nada é apagado (regra inviolável 10). `hoje` vem de quem chama, como a data de
 * referência das métricas, porque este módulo não lê o relógio; data depois de hoje é recusada.
 * Devolve se a conta existe para esse comerciante.
 */
export async function registrarSincronizacaoDaConta(
  db: Executor,
  entrada: { comercianteId: string; contaId: string; data: string; hoje: string },
): Promise<boolean> {
  // Recusa data que não existe (2026-02-30) antes de tocar no banco.
  intervaloDeDatas(entrada.data, entrada.data);
  intervaloDeDatas(entrada.hoje, entrada.hoje);
  // Relógio ou fuso errado do importador gravaria um dia futuro e a conta pareceria em dia até lá.
  if (entrada.data > entrada.hoje) {
    throw new Error(`Sincronização de ${entrada.data} está no futuro (hoje é ${entrada.hoje})`);
  }
  const atualizadas = await db
    .update(conta)
    .set({
      ultimaSincronizacaoEm: sql`greatest(coalesce(${conta.ultimaSincronizacaoEm}, ${entrada.data}::date), ${entrada.data}::date)`,
    })
    .where(and(eq(conta.id, entrada.contaId), eq(conta.comercianteId, entrada.comercianteId)))
    .returning({ id: conta.id });
  return atualizadas.length > 0;
}
