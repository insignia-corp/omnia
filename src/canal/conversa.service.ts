import { Inject, Injectable, NotFoundException, type OnModuleInit } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { ENV } from "../config/config.module";
import type { Env } from "../config/env";
import { DB, type Db } from "../infra/database/database.module";
import { comerciante, documento } from "../infra/database/schema";
import { FilaExtracao } from "../ingestao/fila/fila-extracao";
import { CaixaMensagens, type MensagemGravada } from "./caixa-mensagens";
import { MESSAGE_CHANNEL, type MessageChannel } from "./message-channel";
import { PORTA_AGENTE, type PortaAgente } from "./porta-agente";
import { dataLocal, RELOGIO, type Relogio } from "./relogio";

/**
 * Modo conversa: mensagem do dono entra, o agente responde, a resposta sai pelo canal. O
 * `comercianteId` vem da sessão (ou do remetente já resolvido pelo canal), nunca do modelo.
 */
/** Aviso fixo, sem números e sem texto do modelo (regra 1): a leitura da nota falhou de vez. */
export const TEXTO_FALHA_NOTA =
  "Não consegui ler esta nota. Pode mandar outra foto, com a nota inteira, reta e bem iluminada?";

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
    private readonly filaExtracao: FilaExtracao,
  ) {}

  onModuleInit(): void {
    // Canais que entregam por callback (WhatsApp, canal em memória). No web a entrada é HTTP.
    // O remetente precisa ser o id do comerciante; o WhatsApp resolverá o número antes (#61).
    this.canal.aoReceber(async (m) => {
      if (m.texto) await this.tratar(m.remetente, m.idExterno, m.texto);
    });
    // A ingestão não conhece o canal: registra aqui quem avisa o dono quando a nota falha de vez.
    this.filaExtracao.aoFalharDeVez(async ({ comercianteId, documentoId }) => {
      await this.avisarFalhaExtracao(comercianteId, documentoId);
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
    // A leitura pode ter falhado antes deste aviso existir; aí o worker não achou a conversa e quem avisa é aqui.
    const [doc] = await this.db
      .select({ status: documento.statusExtracao })
      .from(documento)
      .where(and(eq(documento.id, documentoId), eq(documento.comercianteId, comercianteId)))
      .limit(1);
    if (doc?.status === "falha") await this.avisarFalhaExtracao(comercianteId, documentoId);
    return (await this.caixa.buscarPorChave(comercianteId, chave))!;
  }

  /**
   * Aviso de que a leitura da nota falhou de vez. É resposta ao envio do dono, não mensagem proativa
   * (regra 9): só sai quando a nota entrou pela conversa (existe o aviso `nota_<id>`); nota enviada por
   * `POST /documentos/notas` não tem conversa a responder. Idempotente pela chave `nota_falha_<id>`.
   */
  async avisarFalhaExtracao(
    comercianteId: string,
    documentoId: string,
  ): Promise<MensagemGravada | undefined> {
    const pelaConversa = await this.caixa.buscarPorChave(comercianteId, `nota_${documentoId}`);
    if (!pelaConversa) return undefined;
    const chave = `nota_falha_${documentoId}`;
    await this.caixa.enviarResposta({ comercianteId, texto: TEXTO_FALHA_NOTA, execucaoId: null, chave });
    return this.caixa.buscarPorChave(comercianteId, chave);
  }
}
