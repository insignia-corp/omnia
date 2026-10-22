import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { AgenteModule } from "./agente/agente.module";
import { AlertasModule } from "./alertas/alertas.module";
import { AvaliacaoModule } from "./avaliacao/avaliacao.module";
import { CanalModule } from "./canal/canal.module";
import { ConfigModule, ENV } from "./config/config.module";
import type { Env } from "./config/env";
import { DatabaseModule } from "./infra/database/database.module";
import { CAMPO_CORRELACAO, idDaRequisicao } from "./infra/logs/correlacao";
import { IngestaoModule } from "./ingestao/ingestao.module";
import { MetricasModule } from "./metricas/metricas.module";
import { RedisModule } from "./infra/redis/redis.module";
import { SaudeController } from "./saude/saude.controller";

/** pino-pretty é dependência de desenvolvimento e não existe na imagem de produção. */
function temPinoPretty(): boolean {
  try {
    require.resolve("pino-pretty");
    return true;
  } catch {
    return false;
  }
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          genReqId: idDaRequisicao,
          // O mesmo id vai nos jobs que a requisição enfileira (ver `idCorrelacaoAtual`).
          customProps: (req) => ({ [CAMPO_CORRELACAO]: (req as { id?: unknown }).id }),
          // Nunca logar segredos, tokens ou dados bancários.
          redact: ["req.headers.authorization", "req.headers.cookie", "*.apiKey", "*.token", "*.senha"],
          transport:
            env.NODE_ENV === "development" && temPinoPretty() ? { target: "pino-pretty" } : undefined,
        },
      }),
    }),
    DatabaseModule,
    RedisModule,
    AgenteModule,
    IngestaoModule,
    MetricasModule,
    AlertasModule,
    CanalModule,
    AvaliacaoModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
