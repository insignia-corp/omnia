/**
 * Contrato comum de retorno das métricas e das ferramentas do agente (issue #32).
 * Toda ferramenta devolve valor, período, número de registros e menor confiança (edital 9.4).
 *
 * Para o verificador de números: valores em dinheiro em chaves `*_centavos`, percentuais já
 * arredondados para exibição em chaves `*_percentual`.
 */
export interface Periodo {
  /** Data ISO, ex.: "2026-10-12". */
  inicio: string;
  fim: string;
}

export interface ResultadoMetrica<T> {
  valor: T;
  periodo: Periodo;
  n_registros: number;
  /** Menor confiança entre os dados usados, de 0 a 1; null quando não há registro. */
  menor_confianca: number | null;
}

/** Ausência explícita de dado: o agente pergunta ou diz que não sabe, nunca estima. */
export interface DadoAusente {
  ausente: true;
  motivo: string;
  /** O que perguntar ao dono para resolver, quando houver. */
  pergunta_sugerida?: string;
}

export const dadoAusente = (motivo: string, pergunta_sugerida?: string): DadoAusente => ({
  ausente: true,
  motivo,
  ...(pergunta_sugerida ? { pergunta_sugerida } : {}),
});
