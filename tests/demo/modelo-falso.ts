import type { BetaContentBlock, BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ModeloLinguagem } from "../../src/agente/llm/modelo-linguagem";

/** Modelo falso para os e2e do canal: responde sempre com o mesmo texto (sem números) e conta as chamadas. */
export class ModeloFalso implements ModeloLinguagem {
  readonly nome = "claude-opus-5-5";
  chamadas = 0;
  /** Simula um modelo lento (ms); o teste pode ligar e desligar. */
  atrasoMs = 0;
  /** Roda no meio de cada chamada, por exemplo para mover um relógio falso. */
  aoGerar: (() => void) | undefined;

  constructor(private readonly texto = "Tudo certo por aqui. Sigo de olho no seu negócio.") {}

  async gerar(): Promise<BetaMessage> {
    this.chamadas++;
    if (this.atrasoMs > 0) await new Promise((r) => setTimeout(r, this.atrasoMs));
    this.aoGerar?.();
    return {
      id: `msg_falsa_${this.chamadas}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: this.texto }] as BetaContentBlock[],
      usage: {
        input_tokens: 1000,
        output_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as BetaMessage;
  }
}
