import type { z } from "zod";
import type { ConsumoTokens } from "../../agente/llm/modelo-linguagem";

export interface PedidoSugestao {
  sistema: string;
  /** Mensagem montada pelo código; dados da nota entram só dentro de `<dados>`. */
  usuario: string;
  /** Esquema que o modelo deve seguir na saída. */
  esquemaSaida: z.ZodType;
}

export interface RespostaSugestao {
  texto: string;
  /** O modelo recusou por segurança; não há saída a aproveitar. */
  recusou: boolean;
  consumo: ConsumoTokens;
  modelo: string;
}

/** Porta do modelo que sugere vínculos. O Sugestor depende só disto (testável com cliente falso). */
export interface ClienteSugestao {
  sugerir(pedido: PedidoSugestao): Promise<RespostaSugestao>;
}
