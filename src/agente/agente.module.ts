import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { SessaoGuard } from "../comerciante/sessao";
import { AgenteService } from "./agente.service";
import { CONSULTA_EXECUCOES, ConsultaExecucoesPostgres } from "./execucao/consulta-execucoes";
import { ExecucoesController } from "./execucao/execucoes.controller";
import {
  REGISTRO_EXECUCOES,
  RegistroExecucoesPostgres,
  type RegistroExecucoes,
} from "./execucao/registro-execucoes";
import { ConversaService } from "./conversa/conversa.service";
import { montarCatalogo } from "./ferramentas/catalogo";
import { RegistroFerramentas } from "./ferramentas/registro-ferramentas";
import { ModeloAnthropic } from "./llm/modelo-anthropic";
import { MODELO_LINGUAGEM, type ModeloLinguagem } from "./llm/modelo-linguagem";
import { carregarPromptSistema } from "./prompts/prompt-sistema";

@Module({
  controllers: [ExecucoesController],
  providers: [
    SessaoGuard,
    { provide: CONSULTA_EXECUCOES, inject: [DB], useFactory: (db: Db) => new ConsultaExecucoesPostgres(db) },
    { provide: MODELO_LINGUAGEM, inject: [ENV], useFactory: (env: Env) => new ModeloAnthropic(env) },
    // Cada plano acrescenta as suas ferramentas no próprio arquivo; ver ferramentas/catalogo.ts.
    {
      provide: RegistroFerramentas,
      inject: [DB],
      useFactory: (db: Db) => new RegistroFerramentas(montarCatalogo({ db })),
    },
    { provide: REGISTRO_EXECUCOES, inject: [DB], useFactory: (db: Db) => new RegistroExecucoesPostgres(db) },
    {
      provide: ConversaService,
      inject: [ENV, DB, AgenteService],
      useFactory: (env: Env, db: Db, agente: AgenteService) =>
        new ConversaService(agente, db, env.AGENTE_HISTORICO_TURNOS),
    },
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
          maxMs: env.AGENTE_TIMEOUT_MS,
          esforcoPorGatilho: {
            mensagem_dono: env.LLM_ESFORCO_CONVERSA,
            relatorio_diario: env.LLM_ESFORCO,
            nota_processada: env.LLM_ESFORCO,
          },
        }),
    },
  ],
  exports: [AgenteService, ConversaService, RegistroFerramentas],
})
export class AgenteModule {}
