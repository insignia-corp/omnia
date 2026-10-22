import Anthropic from "@anthropic-ai/sdk";
import { esquemaSaidaJson } from "./esquema-saida-json";
import { ErroClienteVisao, type ClienteVisao, type PedidoVisao, type RespostaVisao } from "./cliente-visao";

export interface OpcoesClienteVisaoAnthropic {
  apiKey?: string;
  modelo: string;
  timeoutMs: number;
}

/**
 * Mesma política de repetição do SDK: sem status (rede), 408 (timeout), 409 (conflito), 429 e 5xx
 * valem outra tentativa do BullMQ; os demais 4xx (imagem grande demais, pedido inválido) não.
 */
export function statusTransitorio(status: number | undefined): boolean {
  return status === undefined || status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * Modelo com visão pela API da Anthropic.
 *
 * - Saída por `output_config.format` (JSON conforme o esquema). `tool_choice` forçado dá 400 no
 *   Sonnet 5.5, e o Extrator não precisa de ferramenta.
 * - Esforço `low`: ler uma nota é transcrição, não raciocínio.
 * - `fallbacks: "default"`: se o modelo recusar por um classificador de segurança, a API refaz o
 *   pedido em outro modelo dentro da mesma chamada.
 * - Criado sob demanda, para a API subir sem chave configurada.
 */
export class ClienteVisaoAnthropic implements ClienteVisao {
  private cliente: Anthropic | undefined;

  constructor(private readonly opcoes: OpcoesClienteVisaoAnthropic) {}

  async extrair(pedido: PedidoVisao): Promise<RespostaVisao> {
    this.cliente ??= new Anthropic({
      ...(this.opcoes.apiKey ? { apiKey: this.opcoes.apiKey } : {}),
      timeout: this.opcoes.timeoutMs,
      maxRetries: 1,
    });
    try {
      const resposta = await this.cliente.beta.messages.create({
        model: this.opcoes.modelo,
        max_tokens: 8000,
        system: pedido.sistema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: pedido.imagem.mediaType, data: pedido.imagem.base64 },
              },
              { type: "text", text: "Extraia os dados desta nota de compra." },
            ],
          },
          ...(pedido.correcao
            ? [
                { role: "assistant" as const, content: pedido.correcao.respostaAnterior },
                {
                  role: "user" as const,
                  content: `Esta resposta não valeu: ${pedido.correcao.erros}. Devolva só o JSON corrigido.`,
                },
              ]
            : []),
        ],
        output_config: { effort: "low", format: esquemaSaidaJson(pedido.esquemaSaida) },
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
    } catch (e) {
      if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.RateLimitError) {
        throw new ErroClienteVisao(e.message, true);
      }
      if (e instanceof Anthropic.APIError) {
        throw new ErroClienteVisao(e.message, statusTransitorio(e.status as number | undefined));
      }
      throw e;
    }
  }
}
