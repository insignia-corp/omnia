import {
  Inject,
  Injectable,
  Logger,
  Optional,
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

export const APOS_EXTRACAO = Symbol("APOS_EXTRACAO");
/** Chamado ao final de uma extração que gravou a compra (`extraido` ou `revisao`). */
export type AposExtracao = (nota: JobExtracao & { compraId: string }) => Promise<void>;

const TENTATIVAS = 3;
const ESPERA_INICIAL_MS = 5_000;

/**
 * Quem avisa o dono quando a leitura da nota falha de vez. O canal registra (ele importa a
 * ingestão, nunca o contrário). Recebe só ids: o texto do aviso é fixo e mora no canal, que confere
 * no banco se o documento está mesmo em `falha` antes de avisar.
 */
export type AvisoFalhaExtracao = (entrada: { documentoId: string; comercianteId: string }) => Promise<void>;

/** Última tentativa do job: `attemptsStarted` já conta a que está rodando (`attemptsMade` só sobe ao falhar). */
export function ehUltimaTentativa(job: Pick<Job, "attemptsStarted" | "opts">): boolean {
  return job.attemptsStarted >= (job.opts.attempts ?? 1);
}

/**
 * O que o worker faz com cada job. Falha de vez (`status: "falha"`, na hora ou na última tentativa)
 * avisa o dono; erro que sobe é tentativa pendente e não avisa. Job repetido (`ignorado`) também chama
 * o aviso: se o processo caiu entre gravar `falha` e avisar, a repetição é a única chance de o dono
 * saber. Quem avisa confere no banco que o documento está em `falha` e é idempotente pela chave da
 * mensagem. O aviso nunca derruba o job: o documento já está resolvido e repetir não refaria a leitura.
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
  if ((r.status === "falha" || r.status === "ignorado") && dep.avisoFalha) {
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
    @Optional() @Inject(APOS_EXTRACAO) private readonly aposExtracao?: AposExtracao,
  ) {
    this.fila = new Queue<JobExtracao>(FILA_EXTRACAO, { connection: this.redis });
  }

  /** Wiring feita uma vez na subida (como `MessageChannel.aoReceber`), não estado de negócio. */
  aoFalharDeVez(aviso: AvisoFalhaExtracao): void {
    this.avisoFalha = aviso;
  }

  onApplicationBootstrap(): void {
    this.worker = new Worker<JobExtracao>(
      FILA_EXTRACAO,
      (job: Job<JobExtracao>) =>
        comCorrelacao(this.pino, job.data.idCorrelacao, { fila: FILA_EXTRACAO, jobId: job.id }, () =>
          this.tratar(job),
        ),
      { connection: this.redis, concurrency: 2 },
    );
    // Sem este ouvinte um erro de conexão derruba o processo.
    this.worker.on("error", () => undefined);
  }

  private async tratar(job: Job<JobExtracao>): Promise<ResultadoProcessamento> {
    const r = await tratarJobExtracao(job, {
      processador: this.processador,
      avisoFalha: this.avisoFalha,
      logger: this.logger,
    });
    if (
      this.aposExtracao &&
      r.compraId &&
      (r.status === "extraido" || r.status === "revisao")
    ) {
      try {
        await this.aposExtracao({
          documentoId: job.data.documentoId,
          comercianteId: job.data.comercianteId,
          compraId: r.compraId,
        });
      } catch (e) {
        this.logger.error(
          `Gancho pós-extração falhou para o documento ${job.data.documentoId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return r;
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
