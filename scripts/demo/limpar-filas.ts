import { Queue, type Job } from "bullmq";
import type Redis from "ioredis";
import { setTimeout as esperar } from "node:timers/promises";
import { FILA_RELATORIO_DIARIO } from "../../src/canal/jobs/fila-relatorio-diario";
import { FILA_EXTRACAO } from "../../src/ingestao/fila/fila-extracao";

const ESTADOS = ["completed", "failed", "delayed", "waiting", "prioritized"] as const;

export interface OpcoesLimpeza {
  /** Quanto esperar os jobs ativos da demo terminarem (com as filas pausadas) antes de desistir do reset. */
  esperaMaximaMs?: number;
  intervaloMs?: number;
}

/**
 * Remove das filas os jobs dos comerciantes da demo. O `jobId` do relatório diário é comerciante +
 * data, então sem isto o job de hoje, já concluído, impediria um novo envio depois do reset.
 * Não usa `obliterate`: jobs de outros comerciantes ficam.
 *
 * Pausa as duas filas (pausa global: worker não pega job novo, produtor ainda enfileira) durante todo o
 * reset. Espera os jobs ativos da demo terminarem sem remover nada; se não terminarem a tempo, lança
 * erro e as filas voltam como estavam. Depois remove os jobs da demo, roda `durante` (o seed) com as
 * filas paradas e remove de novo o que foi enfileirado nesse meio tempo. Retoma as filas sempre no
 * `finally`; nada no app pausa fila de propósito, então retomar não desfaz pausa de ninguém, e rodar o
 * reset de novo destrava uma pausa deixada por um processo morto. Resta uma janela: produtor que grava
 * depois do seed e enfileira depois da última varredura.
 */
export async function limparFilasDaDemo(
  redis: Redis,
  comercianteIds: string[],
  { esperaMaximaMs = 120_000, intervaloMs = 250 }: OpcoesLimpeza = {},
  durante: () => Promise<void> = async () => {},
): Promise<number> {
  const alvo = new Set(comercianteIds);
  const daDemo = (job: Job) => {
    const dono = (job.data as { comercianteId?: string } | undefined)?.comercianteId;
    return dono !== undefined && alvo.has(dono);
  };
  const filas = [FILA_RELATORIO_DIARIO, FILA_EXTRACAO].map((nome) => new Queue(nome, { connection: redis }));
  const remover = async () => {
    let n = 0;
    for (const fila of filas) {
      for (const job of (await fila.getJobs([...ESTADOS])).filter(daDemo)) {
        await job.remove().then(
          () => n++,
          () => undefined,
        );
      }
    }
    return n;
  };
  const limite = Date.now() + esperaMaximaMs;
  await Promise.all(filas.map((f) => f.pause()));
  try {
    for (;;) {
      const ativos: string[] = [];
      for (const fila of filas) {
        for (const job of (await fila.getJobs(["active"])).filter(daDemo)) ativos.push(`${fila.name}:${job.id}`);
      }
      if (ativos.length === 0) break;
      if (Date.now() >= limite) {
        throw new Error(
          `Jobs da demo ainda em execução (${ativos.join(", ")}); o reset foi cancelado antes do seed. Tente de novo.`,
        );
      }
      await esperar(intervaloMs);
    }
    let removidos = await remover();
    await durante();
    removidos += await remover();
    return removidos;
  } finally {
    // a retomada não pode impedir o fechamento das conexões
    await Promise.allSettled(filas.map((f) => f.resume()));
    await Promise.all(filas.map((f) => f.close()));
  }
}
