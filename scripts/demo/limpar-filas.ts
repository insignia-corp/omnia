import { Queue, type Job } from "bullmq";
import type Redis from "ioredis";
import { setTimeout as esperar } from "node:timers/promises";
import { FILA_RELATORIO_DIARIO } from "../../src/canal/jobs/fila-relatorio-diario";
import { FILA_EXTRACAO } from "../../src/ingestao/fila/fila-extracao";

const ESTADOS = ["completed", "failed", "delayed", "waiting", "prioritized"] as const;

export interface OpcoesLimpeza {
  /** Quanto esperar um job da demo em execução terminar antes de desistir do reset. */
  esperaMaximaMs?: number;
  intervaloMs?: number;
}

/**
 * Remove das filas os jobs dos comerciantes da demo. O `jobId` do relatório diário é comerciante +
 * data, então sem isto o job de hoje, já concluído, impediria um novo envio depois do reset.
 * Não usa `obliterate`: jobs de outros comerciantes ficam.
 *
 * Job em execução não sai (BullMQ recusa) e, se o seed rodasse por cima dele, ele gravaria dado velho
 * ou mandaria relatório na demo recém-zerada. Por isso a limpeza espera os jobs ativos da demo
 * terminarem (e remove o que sobrar deles) e, se não terminarem a tempo, lança erro antes do seed.
 */
export async function limparFilasDaDemo(
  redis: Redis,
  comercianteIds: string[],
  { esperaMaximaMs = 120_000, intervaloMs = 250 }: OpcoesLimpeza = {},
): Promise<number> {
  const alvo = new Set(comercianteIds);
  const daDemo = (job: Job) => {
    const dono = (job.data as { comercianteId?: string } | undefined)?.comercianteId;
    return dono !== undefined && alvo.has(dono);
  };
  const filas = [FILA_RELATORIO_DIARIO, FILA_EXTRACAO].map((nome) => new Queue(nome, { connection: redis }));
  const limite = Date.now() + esperaMaximaMs;
  let removidos = 0;
  try {
    for (;;) {
      const ativos: string[] = [];
      for (const fila of filas) {
        for (const job of (await fila.getJobs([...ESTADOS])).filter(daDemo)) {
          await job.remove().then(
            () => removidos++,
            () => undefined,
          );
        }
        for (const job of (await fila.getJobs(["active"])).filter(daDemo))
          ativos.push(`${fila.name}:${job.id}`);
      }
      if (ativos.length === 0) return removidos;
      if (Date.now() >= limite) {
        throw new Error(
          `Jobs da demo ainda em execução (${ativos.join(", ")}); o reset foi cancelado antes do seed. Tente de novo.`,
        );
      }
      await esperar(intervaloMs);
    }
  } finally {
    await Promise.all(filas.map((f) => f.close()));
  }
}
