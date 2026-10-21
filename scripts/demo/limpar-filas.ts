import { Queue } from "bullmq";
import type Redis from "ioredis";
import { FILA_RELATORIO_DIARIO } from "../../src/canal/jobs/fila-relatorio-diario";
import { FILA_EXTRACAO } from "../../src/ingestao/fila/fila-extracao";

const ESTADOS = ["completed", "failed", "delayed", "waiting", "prioritized"] as const;

/**
 * Remove das filas os jobs dos comerciantes da demo. O `jobId` do relatório diário é comerciante +
 * data, então sem isto o job de hoje, já concluído, impediria um novo envio depois do reset.
 * Não usa `obliterate`: jobs de outros comerciantes ficam.
 */
export async function limparFilasDaDemo(redis: Redis, comercianteIds: string[]): Promise<number> {
  const alvo = new Set(comercianteIds);
  let removidos = 0;
  for (const nome of [FILA_RELATORIO_DIARIO, FILA_EXTRACAO]) {
    const fila = new Queue(nome, { connection: redis });
    try {
      for (const job of await fila.getJobs([...ESTADOS])) {
        const dono = (job.data as { comercianteId?: string } | undefined)?.comercianteId;
        if (dono && alvo.has(dono)) {
          // Job em execução não sai (BullMQ recusa); os outros estados saem.
          await job.remove().then(
            () => removidos++,
            () => undefined,
          );
        }
      }
    } finally {
      await fila.close();
    }
  }
  return removidos;
}
