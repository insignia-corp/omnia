import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { AgenteModule } from "../agente/agente.module";
import { AgenteService } from "../agente/agente.service";
import { SessaoGuard } from "../comerciante/sessao";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { IngestaoModule } from "../ingestao/ingestao.module";
import { CaixaMensagens } from "./caixa-mensagens";
import { ConversaService } from "./conversa.service";
import { criarCanal } from "./criar-canal";
import { FONTE_RELATORIO, fonteRelatorioPadrao } from "./jobs/fonte-relatorio";
import { FilaRelatorioDiario } from "./jobs/fila-relatorio-diario";
import { RelatorioDiarioService } from "./jobs/relatorio-diario.service";
import { MESSAGE_CHANNEL } from "./message-channel";
import { PORTA_AGENTE } from "./porta-agente";
import { RELOGIO, relogioDoSistema } from "./relogio";
import { ChatWebController } from "./web/chat-web.controller";
import { PaginaChatController } from "./web/pagina-chat.controller";

@Module({
  imports: [
    AgenteModule,
    IngestaoModule,
    MulterModule.registerAsync({
      inject: [ENV],
      // Mesmo teto de upload da ingestão: a foto vai direto ao armazenamento.
      useFactory: (env: Env) => ({ limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1 } }),
    }),
  ],
  controllers: [ChatWebController, PaginaChatController],
  providers: [
    SessaoGuard,
    { provide: MESSAGE_CHANNEL, inject: [ENV], useFactory: (env: Env) => criarCanal(env) },
    { provide: RELOGIO, useValue: relogioDoSistema },
    { provide: PORTA_AGENTE, useExisting: AgenteService },
    // Até o resumo diário (#40) e o motor de alertas (#43) existirem; o plano A troca a fonte.
    { provide: FONTE_RELATORIO, useValue: fonteRelatorioPadrao },
    CaixaMensagens,
    ConversaService,
    RelatorioDiarioService,
    FilaRelatorioDiario,
  ],
  exports: [MESSAGE_CHANNEL, CaixaMensagens],
})
export class CanalModule {}
