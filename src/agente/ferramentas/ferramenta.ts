import type { z } from "zod";

/**
 * Contexto da sessão, montado pelo código a partir de quem está falando (número do WhatsApp,
 * sessão do chat web, job agendado). O modelo nunca escolhe o comerciante: o esquema de
 * entrada das ferramentas não tem `comerciante_id` (regra inviolável 3).
 */
export interface ContextoSessao {
  readonly comercianteId: string;
  readonly nomeComercio: string;
  /** Data de referência da execução (ISO), para as ferramentas não dependerem do relógio. */
  readonly dataReferencia: string;
}

/** O que a ferramenta faz no mundo. No MVP só `nenhum` e `escreve_config` (regra 7). */
export type EfeitoFerramenta = "nenhum" | "pergunta_dono" | "escreve_config";

export interface Ferramenta<E extends z.ZodObject = z.ZodObject, S = unknown> {
  /** Nome em inglês, como o modelo vê (convenção do projeto). */
  readonly nome: string;
  /** Descrição para o modelo: quando usar, o que devolve, limitações. */
  readonly descricao: string;
  /** Use z.strictObject para o modelo não inventar campos. */
  readonly entrada: E;
  readonly efeito: EfeitoFerramenta;
  executar(contexto: ContextoSessao, entrada: z.infer<E>): Promise<S>;
}

export function definirFerramenta<E extends z.ZodObject, S>(f: Ferramenta<E, S>): Ferramenta<E, S> {
  return f;
}
