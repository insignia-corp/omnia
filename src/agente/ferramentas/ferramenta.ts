import type { z } from "zod";
import type { Executor } from "../../infra/database/database.module";

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
  /**
   * Só na escrita confirmada pelo "sim" (issue #104): a transação em que a proposta muda de estado. A
   * ferramenta escreve por ela, então proposta e escrita valem juntas ou nenhuma vale.
   */
  readonly executor?: Executor;
}

/**
 * O que a ferramenta faz no mundo. No MVP só `nenhum` e `escreve_config` (regra 7). `nenhum` quer
 * dizer sem efeito sobre dinheiro nem sobre a configuração do dono; pode materializar estado
 * derivado das métricas, idempotente e só de acréscimo (por exemplo, os candidatos a alerta de
 * `list_alert_candidates`), sem confirmação do dono.
 */
export type EfeitoFerramenta = "nenhum" | "pergunta_dono" | "escreve_config";

/** Texto do pedido de confirmação e do aviso depois do "sim", montados em código (sem modelo). */
export interface DescricaoConfirmacao {
  /** Pergunta ao dono, ex.: Quer que eu registre R$ 12,90 como preço-meta de "Arroz"? */
  pergunta: string;
  /** Frase no passado, enviada depois de executar. Só números que a ferramenta devolve. */
  resumo: string;
}

export interface Ferramenta<E extends z.ZodObject = z.ZodObject, S = unknown> {
  /** Nome em inglês, como o modelo vê (convenção do projeto). */
  readonly nome: string;
  /** Descrição para o modelo: quando usar, o que devolve, limitações. */
  readonly descricao: string;
  /** Use z.strictObject para o modelo não inventar campos. */
  readonly entrada: E;
  readonly efeito: EfeitoFerramenta;
  executar(contexto: ContextoSessao, entrada: z.infer<E>): Promise<S>;
  /**
   * Obrigatória em `escreve_config` para o dono poder confirmar: o texto vem do código a partir da
   * entrada já validada, nunca do modelo. Sem ela a ferramenta só recusa (sem proposta de confirmação).
   */
  descreverConfirmacao?(contexto: ContextoSessao, entrada: z.infer<E>): Promise<DescricaoConfirmacao>;
}

export function definirFerramenta<E extends z.ZodObject, S>(f: Ferramenta<E, S>): Ferramenta<E, S> {
  return f;
}
