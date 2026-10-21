/**
 * Contrato comum de retorno das métricas e das ferramentas do agente (issue #32).
 * Toda ferramenta devolve valor, período, número de registros, menor confiança e origem dos
 * dados (edital 9.4 e regra inviolável 4).
 *
 * Para o verificador de números: valores em dinheiro em chaves `*_centavos`, percentuais já
 * arredondados para exibição em chaves `*_percentual`.
 */

/** De onde veio o dado. Espelha o enum `origem_dado` do banco. */
export type OrigemDado = "foto_nota" | "nfe" | "planilha" | "banco" | "dono";

export interface Periodo {
  /** Data ISO, ex.: "2026-10-12". */
  inicio: string;
  fim: string;
}

export interface ResultadoMetrica<T> {
  valor: T;
  periodo: Periodo;
  /** Quantos registros de origem entraram no cálculo (linhas de venda, itens de compra, transações). */
  n_registros: number;
  /** Menor confiança entre os dados usados, de 0 a 1; null quando não há registro. */
  menor_confianca: number | null;
  /** De onde vieram os dados usados, sem repetição e em ordem alfabética. */
  origens: OrigemDado[];
}

/** Ausência explícita de dado: o agente pergunta ou diz que não sabe, nunca estima. */
export interface DadoAusente {
  ausente: true;
  /** Identificador estável do motivo, para o código decidir. O texto de `motivo` é para o agente. */
  codigo: string;
  motivo: string;
  /** O que perguntar ao dono para resolver, quando houver. */
  pergunta_sugerida?: string;
}

export const dadoAusente = (codigo: string, motivo: string, pergunta_sugerida?: string): DadoAusente => ({
  ausente: true,
  codigo,
  motivo,
  ...(pergunta_sugerida ? { pergunta_sugerida } : {}),
});

export const ehDadoAusente = (resultado: unknown): resultado is DadoAusente =>
  typeof resultado === "object" && resultado !== null && "ausente" in resultado && resultado.ausente === true;

/**
 * O que uma fonte de dados informa sobre si mesma ao entrar num cálculo. Uma linha do banco
 * vale 1 registro; um total do dia vale quantas linhas somou.
 */
export interface Procedencia {
  registros: number;
  menorConfianca: number | null;
  origens: readonly OrigemDado[];
}

export const procedenciaDeUmRegistro = (origem: OrigemDado, confianca: number): Procedencia => ({
  registros: 1,
  menorConfianca: confianca,
  origens: [origem],
});

/** A procedência de um resultado já calculado, para uma métrica derivada de outras. */
export const procedenciaDe = (resultado: ResultadoMetrica<unknown>): Procedencia => ({
  registros: resultado.n_registros,
  menorConfianca: resultado.menor_confianca,
  origens: resultado.origens,
});

type ProcedenciaResumida = Pick<ResultadoMetrica<unknown>, "n_registros" | "menor_confianca" | "origens">;

/** Soma os registros, fica com a pior confiança e junta as origens de todas as fontes usadas. */
export function combinarProcedencias(fontes: readonly Procedencia[]): ProcedenciaResumida {
  let registros = 0;
  let menorConfianca: number | null = null;
  const origens = new Set<OrigemDado>();
  for (const fonte of fontes) {
    registros += fonte.registros;
    if (fonte.menorConfianca !== null) {
      menorConfianca =
        menorConfianca === null ? fonte.menorConfianca : Math.min(menorConfianca, fonte.menorConfianca);
    }
    for (const origem of fonte.origens) origens.add(origem);
  }
  return { n_registros: registros, menor_confianca: menorConfianca, origens: [...origens].sort() };
}

/** Monta o resultado de uma métrica a partir das fontes que ela usou. */
export function resultadoMetrica<T>(
  valor: T,
  periodo: Periodo,
  fontes: readonly Procedencia[],
): ResultadoMetrica<T> {
  return { valor, periodo, ...combinarProcedencias(fontes) };
}
