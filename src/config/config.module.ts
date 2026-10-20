import { Global, Module } from "@nestjs/common";
import { carregarEnv, type Env } from "./env";

export const ENV = Symbol("ENV");

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => carregarEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
