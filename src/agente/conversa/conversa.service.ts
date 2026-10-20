import type { Executor } from "../../infra/database/database.module";
import type { AgenteService, RespostaAgente } from "../agente.service";
import type { ContextoSessao } from "../ferramentas/ferramenta";
import { carregarHistorico } from "./historico";

export interface PedidoConversa {
  contexto: ContextoSessao;
  /** O que o dono escreveu agora. */
  texto: string;
  /** Id (`mensagem.id`) da mensagem do dono, se o canal já a gravou: sai do histórico. */
  mensagemAtualId?: string;
}

/**
 * Modo conversa (issue #55): responde a uma mensagem do dono com as últimas falas da conversa,
 * lidas do banco. Quem grava as mensagens recebida e enviada em `mensagem` é o canal.
 */
export class ConversaService {
  constructor(
    private readonly agente: AgenteService,
    private readonly db: Executor,
    private readonly maxTurnos: number,
  ) {}

  async responder(pedido: PedidoConversa): Promise<RespostaAgente> {
    const historico = await carregarHistorico(
      this.db,
      pedido.contexto.comercianteId,
      this.maxTurnos,
      pedido.mensagemAtualId,
    );
    return this.agente.executar({
      contexto: pedido.contexto,
      gatilho: "mensagem_dono",
      entrada: pedido.texto,
      historico,
    });
  }
}
