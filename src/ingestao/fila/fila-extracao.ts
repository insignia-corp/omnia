import {
  Inject,
  Injectable,
  Logger,
  type LoggerService,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { Queue, Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { comCorrelacao, idCorrelacaoAtual } from "../../infra/logs/correlacao";
import { REDIS } from "../../infra/redis/redis.module";
import type { ProcessadorExtracao, ResultadoProcessamento } from "../processador-extracao";

export const FILA_EXTRACAO = "extrair-nota";
export const PROCESSADOR_EXTRACAO = Symbol("PROCESSADOR_EXTRACAO");

export interface JobExtracao {
  documentoId: string;
  comercianteId: string;
  /** Id da requisição que enfileirou o job: liga os logs da API aos do worker (#10). */
  idCorrelacao?: string;
}

const TENTATIVAS = 3;
const ESPERA_INICIAL_MS = 5_000;

/**
 * Quem avisa o dono quando a leitura da nota falha de vez. O canal registra (ele importa a
 * ingestão, nunca o contrário). Recebe só ids: o texto do aviso é fixo e mora no canal.
 */
export type AvisoFalhaExtracao = (entrada: { documentoId: string; comercianteId: string }) => Promise<void>;

/** Última tentativa do job: `attemptsStarted` já conta a que está rodando (`attemptsMade` só sobe ao falhar). */
export function ehUltimaTentativa(job: Pick<Job, "attemptsStarted" | "opts">): boolean {
  return job.attemptsStarted >= (job.opts.attempts ?? 1);
}

/**
 * O que o worker faz com cada job. Falha de vez (`status: "falha"`, na hora ou na última tentativa)
 * avisa o dono; erro que sobe é tentativa pendente e não avisa. O aviso é idempotente pela chave da
 * mensagem e nunca derruba o job: o documento já está em `falha` e repetir não refaria a leitura.
 */
export async function tratarJobExtracao(
  job: Pick<Job<JobExtracao>, "data" | "attemptsStarted" | "opts">,
  dep: {
    processador: Pick<ProcessadorExtracao, "processar">;
    avisoFalha: AvisoFalhaExtracao | undefined;
    logger: Pick<LoggerService, "log" | "warn">;
  },
): Promise<ResultadoProcessamento> {
  const entrada = { documentoId: job.data.documentoId, comercianteId: job.data.comercianteId };
  const r = await dep.processador.processar(entrada, ehUltimaTentativa(job));
  dep.logger.log(`Extração do documento ${entrada.documentoId}: ${r.status}`);
  if (r.status === "falha" && dep.avisoFalha) {
    try {
      await dep.avisoFalha(entrada);
    } catch (e) {
      dep.logger.warn(
        `Aviso de falha da nota ${entrada.documentoId} não saiu: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  return r;
}

/**
 * Fila e worker do job `extrair-nota` no BullMQ. O estado fica no Redis e no PostgreSQL, nunca no
 * processo (regra inviolável 11). O `jobId` é o documento do comerciante: enviar o mesmo arquivo de
 * novo não cria outro job.
 */
@Injectable()
export class FilaExtracao implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly fila: Queue<JobExtracao>;
  private worker: Worker<JobExtracao> | undefined;
  private readonly logger = new Logger(FilaExtracao.name);
  private avisoFalha: AvisoFalhaExtracao | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(PROCESSADOR_EXTRACAO) private readonly processador: ProcessadorExtracao,
    private readonly pino: PinoLogger,
  ) {
    this.fila = new Queue<JobExtracao>(FILA_EXTRACAO, { connection: this.redis });
  }

  /** Wiring feita uma vez na subida (como `MessageChannel.aoReceber`), não estado de negócio. */
  aoFalharDeVez(aviso: AvisoFalhaExtracao): void {
    this.avisoFalha = aviso;
  }

  // Depois de todos os `onModuleInit`: o canal já registrou o aviso antes de o worker pegar o primeiro job.
  onApplicationBootstrap(): void {
    this.worker = new Worker<JobExtracao>(
      FILA_EXTRACAO,
      (job: Job<JobExtracao>) =>
        comCorrelacao(this.pino, job.data.idCorrelacao, { fila: FILA_EXTRACAO, jobId: job.id }, () =>
          tratarJobExtracao(job, {
            processador: this.processador,
            avisoFalha: this.avisoFalha,
            logger: this.logger,
          }),
        ),
      { connection: this.redis, concurrency: 2 },
    );
    // Sem este ouvinte um erro de conexão derruba o processo.
    this.worker.on("error", () => undefined);
  }

  async enfileirar(job: JobExtracao): Promise<void> {
    await this.fila.add(
      FILA_EXTRACAO,
      { ...job, idCorrelacao: job.idCorrelacao ?? idCorrelacaoAtual(this.pino) },
      {
        // BullMQ não aceita ":" em jobId.
        jobId: `${job.comercianteId}_${job.documentoId}`,
        attempts: TENTATIVAS,
        backoff: { type: "exponential", delay: ESPERA_INICIAL_MS },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.fila.close();
  }
}
