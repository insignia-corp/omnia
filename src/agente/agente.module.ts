import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { AgenteService } from "./agente.service";
import {
  REGISTRO_EXECUCOES,
  RegistroExecucoesPostgres,
  type RegistroExecucoes,
} from "./execucao/registro-execucoes";
import { montarCatalogo } from "./ferramentas/catalogo";
import { RegistroFerramentas } from "./ferramentas/registro-ferramentas";
import { ModeloAnthropic } from "./llm/modelo-anthropic";
import { MODELO_LINGUAGEM, type ModeloLinguagem } from "./llm/modelo-linguagem";
import { carregarPromptSistema } from "./prompts/prompt-sistema";

@Module({
  providers: [
    { provide: MODELO_LINGUAGEM, inject: [ENV], useFactory: (env: Env) => new ModeloAnthropic(env) },
    // Cada plano acrescenta as suas ferramentas no próprio arquivo; ver ferramentas/catalogo.ts.
    {
      provide: RegistroFerramentas,
      inject: [DB],
      useFactory: (db: Db) => new RegistroFerramentas(montarCatalogo({ db })),
    },
    { provide: REGISTRO_EXECUCOES, inject: [DB], useFactory: (db: Db) => new RegistroExecucoesPostgres(db) },
    {
      provide: AgenteService,
      inject: [ENV, MODELO_LINGUAGEM, RegistroFerramentas, REGISTRO_EXECUCOES],
      useFactory: (
        env: Env,
        modelo: ModeloLinguagem,
        ferramentas: RegistroFerramentas,
        registro: RegistroExecucoes,
      ) =>
        new AgenteService(modelo, ferramentas, registro, carregarPromptSistema(), {
          maxIteracoes: env.AGENTE_MAX_ITERACOES,
          maxRegeracoes: env.AGENTE_MAX_REGERACOES,
        }),
    },
  ],
  exports: [AgenteService, RegistroFerramentas],
})
export class AgenteModule {}
