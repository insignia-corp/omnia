import type { ContextoSessao } from "../../agente/ferramentas/ferramenta";

export const FONTE_RELATORIO = Symbol("FONTE_RELATORIO");

/**
 * Entrada do agente no relatório diário. Quando o resumo diário (#40) e o motor de alertas (#43)
 * existirem, o plano A troca a implementação; o job não muda.
 */
export interface FonteRelatorio {
  entrada(contexto: ContextoSessao): Promise<string>;
}

export const fonteRelatorioPadrao: FonteRelatorio = {
  entrada: (contexto) =>
    Promise.resolve(`Relatório diário de ${contexto.dataReferencia}. Resuma como está o negócio hoje.`),
};
