import { Module } from "@nestjs/common";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { AgenteService } from "./agente.service";
import { ConfirmacaoDoDono, type ResolveConfirmacao } from "./confirmacao/confirmacao-dono";
import { ConfirmacoesPostgres } from "./confirmacao/confirmacoes-postgres";
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
      inject: [ENV, DB],
      // O modelo nunca executa escrita: o pedido vira proposta e o código executa no "sim" do dono (#104).
      useFactory: (env: Env, db: Db) =>
        new RegistroFerramentas(
          montarCatalogo({ db }),
          new ConfirmacoesPostgres(db, env.ACAO_EXPIRA_MINUTOS),
        ),
    },
    {
      provide: ConfirmacaoDoDono,
      inject: [DB, RegistroFerramentas],
      useFactory: (db: Db, ferramentas: RegistroFerramentas) => new ConfirmacaoDoDono(db, ferramentas),
    },
    { provide: REGISTRO_EXECUCOES, inject: [DB], useFactory: (db: Db) => new RegistroExecucoesPostgres(db) },
    {
      provide: AgenteService,
      inject: [ENV, MODELO_LINGUAGEM, RegistroFerramentas, REGISTRO_EXECUCOES, ConfirmacaoDoDono],
      useFactory: (
        env: Env,
        modelo: ModeloLinguagem,
        ferramentas: RegistroFerramentas,
        registro: RegistroExecucoes,
        confirmacao: ResolveConfirmacao,
      ) =>
        new AgenteService(
          modelo,
          ferramentas,
          registro,
          carregarPromptSistema(),
          { maxIteracoes: env.AGENTE_MAX_ITERACOES, maxRegeracoes: env.AGENTE_MAX_REGERACOES },
          confirmacao,
        ),
    },
  ],
  exports: [AgenteService, RegistroFerramentas],
})
export class AgenteModule {}
