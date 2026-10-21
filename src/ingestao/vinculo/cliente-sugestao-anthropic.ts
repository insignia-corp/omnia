import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ClienteSugestao, PedidoSugestao, RespostaSugestao } from "./cliente-sugestao";

export interface OpcoesClienteSugestaoAnthropic {
  apiKey?: string;
  modelo: string;
  timeoutMs: number;
}

/**
 * Modelo de texto pela API da Anthropic para sugerir o vínculo item-produto. Saída por
 * `output_config.format` (JSON conforme o esquema), como o Extrator. Criado sob demanda, para a API
 * subir sem chave configurada. Quem chama trata qualquer erro: sugerir é opcional e nunca derruba a nota.
 */
export class ClienteSugestaoAnthropic implements ClienteSugestao {
  private cliente: Anthropic | undefined;

  constructor(private readonly opcoes: OpcoesClienteSugestaoAnthropic) {}

  async sugerir(pedido: PedidoSugestao): Promise<RespostaSugestao> {
    this.cliente ??= new Anthropic({
      ...(this.opcoes.apiKey ? { apiKey: this.opcoes.apiKey } : {}),
      timeout: this.opcoes.timeoutMs,
      maxRetries: 1,
    });
    const resposta = await this.cliente.beta.messages.create({
      model: this.opcoes.modelo,
      max_tokens: 2000,
      system: pedido.sistema,
      messages: [{ role: "user", content: pedido.usuario }],
      output_config: { format: zodOutputFormat(pedido.esquemaSaida) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    return {
      texto: resposta.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(""),
      recusou: resposta.stop_reason === "refusal",
      consumo: {
        entrada: resposta.usage.input_tokens,
        saida: resposta.usage.output_tokens,
        cacheLeitura: resposta.usage.cache_read_input_tokens ?? 0,
        cacheEscrita: resposta.usage.cache_creation_input_tokens ?? 0,
      },
      modelo: resposta.model,
    };
  }
}
