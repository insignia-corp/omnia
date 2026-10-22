import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { REDIS } from "../../infra/redis/redis.module";
import { VerificadorDeReajuste, type JobReajuste } from "./verificar-reajuste";

export const FILA_REAJUSTE = "reajuste-pos-nota";

const TENTATIVAS = 3;
const ESPERA_INICIAL_MS = 5_000;

/** `jobId` do documento do comerciante: o mesmo documento enfileirado de novo não cria outro job. */
export const chaveReajuste = (job: JobReajuste): string => `${job.comercianteId}_${job.documentoId}`;

/**
 * Fila e worker do job de reajuste no BullMQ, disparado ao final da extração de cada nota. O estado
 * fica no Redis e no PostgreSQL, nunca no processo (regra inviolável 11).
 */
@Injectable()
export class FilaReajuste implements OnModuleInit, OnModuleDestroy {
  private readonly fila: Queue<JobReajuste>;
  private worker: Worker<JobReajuste> | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly verificador: VerificadorDeReajuste,
  ) {
    this.fila = new Queue<JobReajuste>(FILA_REAJUSTE, { connection: this.redis });
  }

  onModuleInit(): void {
    this.worker = new Worker<JobReajuste>(
      FILA_REAJUSTE,
      (job: Job<JobReajuste>) =>
        this.verificador.verificar({
          documentoId: job.data.documentoId,
          comercianteId: job.data.comercianteId,
        }),
      { connection: this.redis, concurrency: 2 },
    );
    // Sem este ouvinte um erro de conexão derruba o processo.
    this.worker.on("error", () => undefined);
  }

  async enfileirar(job: JobReajuste): Promise<void> {
    await this.fila.add(FILA_REAJUSTE, job, {
      // BullMQ não aceita ":" em jobId.
      jobId: chaveReajuste(job),
      attempts: TENTATIVAS,
      backoff: { type: "exponential", delay: ESPERA_INICIAL_MS },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.fila.close();
  }
}
