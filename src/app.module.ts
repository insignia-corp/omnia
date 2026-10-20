import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { AgenteModule } from "./agente/agente.module";
import { ConfigModule, ENV } from "./config/config.module";
import type { Env } from "./config/env";
import { DatabaseModule } from "./infra/database/database.module";
import { RedisModule } from "./infra/redis/redis.module";
import { MetricasModule } from "./metricas/metricas.module";
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
          genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
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
    MetricasModule,
  ],
  controllers: [SaudeController],
})
export class AppModule {}
