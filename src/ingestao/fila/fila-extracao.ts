import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { REDIS } from "../../infra/redis/redis.module";
import type { ProcessadorExtracao } from "../processador-extracao";

export const FILA_EXTRACAO = "extrair-nota";
export const PROCESSADOR_EXTRACAO = Symbol("PROCESSADOR_EXTRACAO");

export interface JobExtracao {
  documentoId: string;
  comercianteId: string;
}

const TENTATIVAS = 3;
const ESPERA_INICIAL_MS = 5_000;

/**
 * Fila e worker do job `extrair-nota` no BullMQ. O estado fica no Redis e no PostgreSQL, nunca no
 * processo (regra inviolável 11). O `jobId` é o documento do comerciante: enviar o mesmo arquivo de
 * novo não cria outro job.
 */
@Injectable()
export class FilaExtracao implements OnModuleInit, OnModuleDestroy {
  private readonly fila: Queue<JobExtracao>;
  private worker: Worker<JobExtracao> | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PROCESSADOR_EXTRACAO) private readonly processador: ProcessadorExtracao,
  ) {
    this.fila = new Queue<JobExtracao>(FILA_EXTRACAO, { connection: this.redis });
  }

  onModuleInit(): void {
    this.worker = new Worker<JobExtracao>(
      FILA_EXTRACAO,
      (job: Job<JobExtracao>) =>
        this.processador.processar(job.data, job.attemptsStarted >= (job.opts.attempts ?? 1)),
      { connection: this.redis, concurrency: 2 },
    );
    // Sem este ouvinte um erro de conexão derruba o processo.
    this.worker.on("error", () => undefined);
  }

  async enfileirar(job: JobExtracao): Promise<void> {
    await this.fila.add(FILA_EXTRACAO, job, {
      // BullMQ não aceita ":" em jobId.
      jobId: `${job.comercianteId}_${job.documentoId}`,
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
