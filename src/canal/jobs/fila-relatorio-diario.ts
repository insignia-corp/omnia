import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { DelayedError, Queue, Worker, type Job } from "bullmq";
import type Redis from "ioredis";
import { PinoLogger } from "nestjs-pino";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DB, type Db } from "../../infra/database/database.module";
import { comerciante } from "../../infra/database/schema";
import { comCorrelacao } from "../../infra/logs/correlacao";
import { REDIS } from "../../infra/redis/redis.module";
import { dataLocal, minutosDoDia, RELOGIO, type Relogio } from "../relogio";
import { fimDoSilencio } from "./horario-silencio";
import { chaveRelatorio, RelatorioDiarioService, type JobRelatorioDiario } from "./relatorio-diario.service";

export const FILA_RELATORIO_DIARIO = "relatorio-diario";
const AGENDADOR = "relatorio-diario-agendador";
const NOME_DISPARO = "disparar";
const NOME_PROCESSAR = "processar";

/**
 * Fila e worker do relatório diário no BullMQ. O agendador repetido (cron + fuso) vive no Redis e
 * dispara um job por comerciante, com `jobId` = chave comerciante + data. Em horário de silêncio o
 * job é adiado para o fim da janela, mantendo a data original. Estado nunca no processo (regra 11).
 */
@Injectable()
export class FilaRelatorioDiario implements OnModuleInit, OnModuleDestroy {
  private readonly fila: Queue;
  private worker: Worker | undefined;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    private readonly servico: RelatorioDiarioService,
    private readonly pino: PinoLogger,
  ) {
    this.fila = new Queue(FILA_RELATORIO_DIARIO, { connection: this.redis });
  }

  async onModuleInit(): Promise<void> {
    this.worker = new Worker(
      FILA_RELATORIO_DIARIO,
      (job: Job, token?: string) =>
        comCorrelacao(this.pino, undefined, { fila: FILA_RELATORIO_DIARIO, jobId: job.id }, () =>
          this.tratar(job, token),
        ),
      {
        connection: this.redis,
        concurrency: 2,
      },
    );
    // Sem este ouvinte um erro de conexão derruba o processo.
    this.worker.on("error", () => undefined);
    await this.fila.upsertJobScheduler(
      AGENDADOR,
      { pattern: this.env.RELATORIO_DIARIO_CRON, tz: this.env.FUSO_HORARIO },
      { name: NOME_DISPARO },
    );
  }

  /** Um job por comerciante e dia; repetir a mesma chave não cria outro. */
  async enfileirar(job: JobRelatorioDiario): Promise<void> {
    await this.fila.add(NOME_PROCESSAR, job, this.opcoes(job));
  }

  /** Cria os jobs do dia para todos os comerciantes (o que o agendador faz no horário). */
  async dispararDoDia(): Promise<void> {
    const data = dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO);
    const donos = await this.db.select({ id: comerciante.id }).from(comerciante);
    if (donos.length === 0) return;
    await this.fila.addBulk(
      donos.map((d) => {
        const job = { comercianteId: d.id, data };
        return { name: NOME_PROCESSAR, data: job, opts: this.opcoes(job) };
      }),
    );
  }

  private async tratar(job: Job, token?: string): Promise<void> {
    if (job.name === NOME_DISPARO) return this.dispararDoDia();
    if (this.servico.emSilencioAgora()) return this.adiar(job, token);
    const resultado = await this.servico.processar(job.data as JobRelatorioDiario);
    // O silêncio pode ter começado durante a chamada ao modelo: nada foi enviado, adia o job.
    if (resultado === "silencio") return this.adiar(job, token);
  }

  /** Adia o job para o fim da janela de silêncio, mantendo `job.data` (e a chave) como estão. */
  private async adiar(job: Job, token?: string): Promise<never> {
    const agora = this.relogio.agora();
    const minutos = minutosDoDia(agora, this.env.FUSO_HORARIO);
    const fim = fimDoSilencio(agora, minutos, {
      inicio: this.env.SILENCIO_INICIO,
      fim: this.env.SILENCIO_FIM,
    });
    await job.moveToDelayed(fim.getTime(), token);
    throw new DelayedError();
  }

  private opcoes(job: JobRelatorioDiario) {
    return {
      // BullMQ não aceita ":" em jobId.
      jobId: chaveRelatorio(job),
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 30_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.fila.close();
  }
}
