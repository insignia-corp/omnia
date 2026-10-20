import type { z } from "zod";

export type TipoImagem = "image/jpeg" | "image/png";

export interface ImagemNota {
  mediaType: TipoImagem;
  base64: string;
}

export interface ConsumoExtracao {
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export interface PedidoVisao {
  sistema: string;
  imagem: ImagemNota;
  /** Esquema que o modelo deve seguir na saída. */
  esquemaSaida: z.ZodType;
  /** Segunda tentativa: o que o modelo respondeu antes e por que não valeu. */
  correcao?: { respostaAnterior: string; erros: string };
}

export interface RespostaVisao {
  texto: string;
  /** O modelo recusou por segurança; não há saída a aproveitar. */
  recusou: boolean;
  consumo: ConsumoExtracao;
  modelo: string;
}

/** Porta do modelo com visão. O Extrator depende só disto (testável com cliente falso). */
export interface ClienteVisao {
  extrair(pedido: PedidoVisao): Promise<RespostaVisao>;
}

/**
 * Falha da chamada ao modelo. `transitorio` (timeout, limite de taxa, erro 5xx) pede nova
 * tentativa do job; os demais casos não adianta repetir.
 */
export class ErroClienteVisao extends Error {
  constructor(
    mensagem: string,
    readonly transitorio: boolean,
  ) {
    super(mensagem);
  }
}
