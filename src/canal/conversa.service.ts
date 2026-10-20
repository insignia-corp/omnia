import { Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { comerciante } from "../infra/database/schema";
import { CaixaMensagens, type MensagemGravada } from "./caixa-mensagens";
import { MESSAGE_CHANNEL, type MessageChannel } from "./message-channel";
import { PORTA_AGENTE, type PortaAgente } from "./porta-agente";
import { dataLocal, RELOGIO, type Relogio } from "./relogio";

/**
 * Modo conversa: mensagem do dono entra, o agente responde, a resposta sai pelo canal. O
 * `comercianteId` vem da sessão (ou do remetente já resolvido pelo canal), nunca do modelo.
 */
@Injectable()
export class ConversaService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(MESSAGE_CHANNEL) private readonly canal: MessageChannel,
    @Inject(PORTA_AGENTE) private readonly agente: PortaAgente,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    private readonly caixa: CaixaMensagens,
  ) {}

  onModuleInit(): void {
    // Canais que entregam por callback (WhatsApp, canal em memória). No web a entrada é HTTP.
    // O remetente precisa ser o id do comerciante; o WhatsApp resolverá o número antes (#61).
    this.canal.aoReceber(async (m) => {
      if (m.texto) await this.tratar(m.remetente, m.idExterno, m.texto);
    });
  }

  /** Reentrega do mesmo `idExterno` não roda o agente de novo: devolve a resposta já gravada. */
  async tratar(comercianteId: string, idExterno: string, texto: string): Promise<MensagemGravada> {
    const [dono] = await this.db
      .select({ nome: comerciante.nome })
      .from(comerciante)
      .where(eq(comerciante.id, comercianteId))
      .limit(1);
    if (!dono) throw new NotFoundException("Comerciante não encontrado");

    const chave = `resposta_${idExterno}`;
    const recebida = await this.caixa.registrarRecebida({ comercianteId, idExterno, texto });
    if (!recebida.nova) {
      const anterior = await this.caixa.buscarPorChave(comercianteId, chave);
      if (anterior) return anterior;
    }

    const resposta = await this.agente.executar({
      contexto: {
        comercianteId,
        nomeComercio: dono.nome,
        dataReferencia: dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO),
      },
      gatilho: "mensagem_dono",
      entrada: texto,
    });
    await this.caixa.enviarResposta({
      comercianteId,
      texto: resposta.mensagem,
      execucaoId: resposta.execucaoId,
      chave,
    });
    const gravada = await this.caixa.buscarPorChave(comercianteId, chave);
    return gravada!;
  }

  /** Aviso de que a nota chegou, sem números: não passa pelo agente. */
  async avisarNotaRecebida(comercianteId: string, documentoId: string): Promise<MensagemGravada> {
    await this.caixa.registrarRecebida({
      comercianteId,
      idExterno: `nota-${documentoId}`,
      texto: "Foto de nota enviada",
    });
    const chave = `nota_${documentoId}`;
    await this.caixa.enviarResposta({
      comercianteId,
      texto: "Recebi a foto da nota e estou lendo. Se algum item ficar em dúvida, eu pergunto.",
      execucaoId: null,
      chave,
    });
    return (await this.caixa.buscarPorChave(comercianteId, chave))!;
  }
}
