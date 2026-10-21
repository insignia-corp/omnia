import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Env } from "../../config/env";
import type { ModeloLinguagem, PedidoModelo } from "./modelo-linguagem";

/**
 * Modelo de linguagem pela API da Anthropic.
 *
 * - Pensamento adaptativo é o padrão do modelo; a profundidade é controlada por `effort`.
 * - `fallbacks: "default"`: se o modelo recusar por um classificador de segurança, a API
 *   refaz o pedido em outro modelo, dentro da mesma chamada.
 * - `cache_control` no topo: ferramentas e prompt de sistema estáveis ficam em cache.
 * - O SDK repete 408, 409, 429, 5xx e erros de conexão com espera exponencial (`LLM_MAX_RETRIES`);
 *   o timeout vem do .env. Esgotadas as tentativas o erro sobe e o loop responde com o fallback.
 */
export class ModeloAnthropic implements ModeloLinguagem {
  private cliente: Anthropic | undefined;

  constructor(
    private readonly env: Pick<
      Env,
      "ANTHROPIC_API_KEY" | "LLM_MODELO" | "LLM_ESFORCO" | "LLM_TIMEOUT_MS" | "LLM_MAX_RETRIES"
    >,
    /** Só os testes trocam o `fetch`, para simular falhas da API sem rede. */
    private readonly fetchPersonalizado?: typeof fetch,
  ) {}

  get nome(): string {
    return this.env.LLM_MODELO;
  }

  async gerar(pedido: PedidoModelo): Promise<BetaMessage> {
    // Criado sob demanda: a API sobe e passa no teste de saúde mesmo sem chave configurada.
    this.cliente ??= new Anthropic({
      ...(this.env.ANTHROPIC_API_KEY ? { apiKey: this.env.ANTHROPIC_API_KEY } : {}),
      timeout: this.env.LLM_TIMEOUT_MS,
      maxRetries: this.env.LLM_MAX_RETRIES,
      ...(this.fetchPersonalizado ? { fetch: this.fetchPersonalizado } : {}),
    });
    return this.cliente.beta.messages.create(
      {
        model: this.env.LLM_MODELO,
        max_tokens: 16000,
        system: pedido.system,
        messages: pedido.messages,
        tools: pedido.tools,
        output_config: { effort: pedido.esforco ?? this.env.LLM_ESFORCO },
        cache_control: { type: "ephemeral" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      pedido.signal ? { signal: pedido.signal } : {},
    );
  }
}
