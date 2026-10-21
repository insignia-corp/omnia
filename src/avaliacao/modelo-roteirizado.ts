import type { BetaContentBlock, BetaStopReason } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ModeloLinguagem, PedidoModelo } from "../agente/llm/modelo-linguagem";
import type { RespostaRoteirizada } from "./tipos";

export const NOME_MODELO_FALSO = "falso-roteirizado";

function resposta(stopReason: BetaStopReason, content: unknown[]): RespostaRoteirizada {
  return {
    id: "msg_roteirizada",
    type: "message",
    role: "assistant",
    model: NOME_MODELO_FALSO,
    stop_reason: stopReason,
    content: content as BetaContentBlock[],
    // Sem consumo: o modo falso não gasta token, então o custo da rodada é zero.
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as BetaMessage;
}

/** Resposta final do modelo: texto para o dono. */
export const texto = (t: string): RespostaRoteirizada => resposta("end_turn", [{ type: "text", text: t }]);

/** Pedido de ferramenta do modelo. */
export const chamar = (nome: string, entrada: unknown, id: string): RespostaRoteirizada =>
  resposta("tool_use", [{ type: "tool_use", id, name: nome, input: entrada }]);

/**
 * Modelo de linguagem do modo falso: devolve as respostas do roteiro na ordem, sem rede e sem custo.
 * Roteiro que acaba antes do fim do loop é erro do caso, e o agente o registra como fallback.
 */
export class ModeloRoteirizado implements ModeloLinguagem {
  readonly nome = NOME_MODELO_FALSO;
  private readonly restantes: RespostaRoteirizada[];

  constructor(roteiro: RespostaRoteirizada[]) {
    this.restantes = structuredClone(roteiro);
  }

  gerar(_pedido: PedidoModelo): Promise<BetaMessage> {
    const proxima = this.restantes.shift();
    return proxima ? Promise.resolve(proxima) : Promise.reject(new Error("Roteiro do modelo acabou"));
  }
}
