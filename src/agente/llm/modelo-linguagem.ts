import type {
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaUsage,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

export interface PedidoModelo {
  system: string;
  messages: BetaMessageParam[];
  tools: BetaTool[];
}

/** Porta do modelo de linguagem. O loop do agente depende só disto (testável com modelo falso). */
export interface ModeloLinguagem {
  readonly nome: string;
  gerar(pedido: PedidoModelo): Promise<BetaMessage>;
}

export const MODELO_LINGUAGEM = Symbol("MODELO_LINGUAGEM");

/** Preço em micro-dólares por token (USD por milhão de tokens = µUSD por token). */
interface Preco {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

const PRECOS: Record<string, Preco> = {
  "claude-opus-5-5": { entrada: 4, saida: 20, cacheLeitura: 0.2, cacheEscrita: 5 },
  "claude-sonnet-5-5": { entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  "claude-haiku-5-5": { entrada: 0.1, saida: 0.5, cacheLeitura: 0.01, cacheEscrita: 0.125 },
};

export interface ConsumoTokens {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export const consumoZerado = (): ConsumoTokens => ({
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
});

export function acumularConsumo(total: ConsumoTokens, uso: BetaUsage): void {
  total.entrada += uso.input_tokens;
  total.saida += uso.output_tokens;
  total.cacheLeitura += uso.cache_read_input_tokens ?? 0;
  total.cacheEscrita += uso.cache_creation_input_tokens ?? 0;
}

/** Custo estimado em micro-dólares inteiros. Modelo sem preço cadastrado custa 0 (ver log). */
export function custoMicrodolares(modelo: string, c: ConsumoTokens): number {
  const p = PRECOS[modelo];
  if (!p) return 0;
  return Math.round(
    c.entrada * p.entrada +
      c.saida * p.saida +
      c.cacheLeitura * p.cacheLeitura +
      c.cacheEscrita * p.cacheEscrita,
  );
}
