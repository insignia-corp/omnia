import { Queue } from "bullmq";
import type Redis from "ioredis";
import { FILA_RELATORIO_DIARIO } from "../../src/canal/jobs/fila-relatorio-diario";
import { FILA_EXTRACAO } from "../../src/ingestao/fila/fila-extracao";

const PARADOS = ["completed", "failed", "delayed", "waiting", "prioritized"] as const;

/** Há job da demo rodando agora: recriar os mesmos comerciantes deixaria o estado sujo. */
export class JobsAtivosDaDemo extends Error {}

/**
 * Remove das filas os jobs dos comerciantes da demo. O `jobId` do relatório diário é comerciante +
 * data, então sem isto o job de hoje, já concluído, impediria um novo envio depois do reset.
 * Não usa `obliterate`: jobs de outros comerciantes ficam. Se algum job da demo estiver em execução, aborta
 * antes de remover qualquer coisa (o job em execução seguiria gravando depois do reset).
 */
export async function limparFilasDaDemo(redis: Redis, comercianteIds: string[]): Promise<number> {
  const alvo = new Set(comercianteIds);
  const daDemo = (job: { data?: unknown }) => {
    const dono = (job.data as { comercianteId?: string } | undefined)?.comercianteId;
    return dono !== undefined && alvo.has(dono);
  };
  const filas = [FILA_RELATORIO_DIARIO, FILA_EXTRACAO].map((nome) => new Queue(nome, { connection: redis }));
  try {
    for (const fila of filas) {
      const ativos = (await fila.getJobs(["active"])).filter(daDemo);
      if (ativos.length > 0) {
        throw new JobsAtivosDaDemo(
          `Há ${ativos.length} job(s) da demo em execução na fila ${fila.name}. Espere terminar e rode o reset de novo.`,
        );
      }
    }
    let removidos = 0;
    for (const fila of filas) {
      for (const job of (await fila.getJobs([...PARADOS])).filter(daDemo)) {
        await job.remove().then(
          () => removidos++,
          () => undefined,
        );
      }
    }
    return removidos;
  } finally {
    await Promise.all(filas.map((f) => f.close()));
  }
}
