import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { RegistroExecucoesPostgres } from "../agente/execucao/registro-execucoes";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { ARMAZENAMENTO } from "../infra/armazenamento/armazenamento";
import { ArmazenamentoDisco } from "../infra/armazenamento/armazenamento-disco";
import { DB, type Db } from "../infra/database/database.module";
import { SessaoGuard } from "../comerciante/sessao";
import { ClienteVisaoAnthropic } from "./extracao/cliente-visao-anthropic";
import type { ClienteVisao } from "./extracao/cliente-visao";
import { ExtratorNotas } from "./extracao/extrator-notas";
import { carregarPromptExtrator } from "./extracao/prompt-extrator";
import { DocumentosController } from "./documentos.controller";
import { DocumentosService } from "./documentos.service";
import { PerguntasController } from "./perguntas.controller";
import { PlanilhasController } from "./planilhas.controller";
import { PlanilhasService } from "./planilhas.service";
import { FilaExtracao, PROCESSADOR_EXTRACAO } from "./fila/fila-extracao";
import { ProcessadorExtracao } from "./processador-extracao";
import { ClienteSugestaoAnthropic } from "./vinculo/cliente-sugestao-anthropic";
import { carregarPromptVinculo } from "./vinculo/prompt-vinculo";
import { SugestorVinculo } from "./vinculo/sugestor-vinculo";

export const CLIENTE_VISAO = Symbol("CLIENTE_VISAO");

@Module({
  imports: [
    MulterModule.registerAsync({
      inject: [ENV],
      // Upload em memória com teto de tamanho: o arquivo vai direto ao armazenamento.
      useFactory: (env: Env) => ({ limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 } }),
    }),
  ],
  controllers: [DocumentosController, PerguntasController, PlanilhasController],
  providers: [
    SessaoGuard,
    DocumentosService,
    PlanilhasService,
    FilaExtracao,
    {
      provide: ARMAZENAMENTO,
      inject: [ENV],
      useFactory: (env: Env) =>
        new ArmazenamentoDisco({ raiz: env.ARMAZENAMENTO_DIR, maxBytes: env.UPLOAD_MAX_BYTES }),
    },
    {
      provide: CLIENTE_VISAO,
      inject: [ENV],
      useFactory: (env: Env): ClienteVisao =>
        new ClienteVisaoAnthropic({
          ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
          modelo: env.EXTRATOR_MODELO,
          timeoutMs: env.LLM_TIMEOUT_MS,
        }),
    },
    {
      provide: PROCESSADOR_EXTRACAO,
      inject: [ENV, DB, ARMAZENAMENTO, CLIENTE_VISAO],
      useFactory: (env: Env, db: Db, armazenamento: ArmazenamentoDisco, cliente: ClienteVisao) =>
        new ProcessadorExtracao({
          db,
          armazenamento,
          extrator: new ExtratorNotas(cliente, carregarPromptExtrator()),
          registro: new RegistroExecucoesPostgres(db),
          limiteConfiancaItem: env.LIMITE_CONFIANCA_ITEM,
          limiteSimilaridade: env.LIMITE_SIMILARIDADE,
          modeloConfigurado: env.EXTRATOR_MODELO,
          // Sem chave não há como sugerir: a nota segue só com a pergunta ao dono.
          ...(env.ANTHROPIC_API_KEY
            ? {
                sugestor: new SugestorVinculo(
                  new ClienteSugestaoAnthropic({
                    apiKey: env.ANTHROPIC_API_KEY,
                    modelo: env.VINCULO_MODELO,
                    timeoutMs: env.LLM_TIMEOUT_MS,
                  }),
                  carregarPromptVinculo(),
                  { modeloConfigurado: env.VINCULO_MODELO },
                ),
              }
            : {}),
        }),
    },
  ],
})
export class IngestaoModule {}
