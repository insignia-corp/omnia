import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { lerArquivoEnv } from "./config/arquivo-env";
import { ENV } from "./config/config.module";
import type { Env } from "./config/env";

async function bootstrap(): Promise<void> {
  lerArquivoEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const env = app.get<Env>(ENV);
  await app.listen(env.PORT);
}

void bootstrap();
