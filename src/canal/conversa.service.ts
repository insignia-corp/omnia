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
const INTERVALO_ESPERA_MS = 250;
/** Folga sobre o tempo limite do modelo para a primeira chamada gravar a resposta. */
const ESPERA_FOLGA_MS = 5_000;

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
      // Reentrega: a primeira ainda pode estar no modelo. Espera a resposta dela em vez de chamar (e
      // cobrar) o agente de novo; só se ela não aparecer a tempo, tenta de novo.
      const anterior = await this.aguardarResposta(comercianteId, chave);
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

  private async aguardarResposta(comercianteId: string, chave: string): Promise<MensagemGravada | undefined> {
    const limite = Date.now() + this.env.LLM_TIMEOUT_MS + ESPERA_FOLGA_MS;
    for (;;) {
      const gravada = await this.caixa.buscarPorChave(comercianteId, chave);
      if (gravada || Date.now() >= limite) return gravada;
      await new Promise((r) => setTimeout(r, INTERVALO_ESPERA_MS));
    }
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
