import type { ContextoSessao } from "../../agente/ferramentas/ferramenta";

export const FONTE_RELATORIO = Symbol("FONTE_RELATORIO");

/**
 * Entrada do agente no relatório diário. Pede o resumo de ontem no formato do vídeo do pitch (etapa 0):
 * como foi o dia, os mais vendidos e os que mais caíram em 7 dias, e o que precisa de atenção. Os números
 * vêm de `get_daily_briefing`; o formato está no prompt (`sistema-v6`, regra 6).
 */
export interface FonteRelatorio {
  entrada(contexto: ContextoSessao): Promise<string>;
}

export const fonteRelatorioPadrao: FonteRelatorio = {
  entrada: (contexto) =>
    Promise.resolve(
      `Relatório diário de ${contexto.dataReferencia}. Mande ao dono o resumo de ontem no formato do relatório ` +
        "diário, só com o que get_daily_briefing devolver.",
    ),
};
