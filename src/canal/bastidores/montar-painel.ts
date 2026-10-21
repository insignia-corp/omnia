import type { ChamadaBastidores, DecisaoAlerta, ItemBastidores, PainelBastidores } from "./tipos";

/** Agrupa por execução, mantendo a ordem em que as chamadas aconteceram. */
export function agruparChamadas<T extends { execucaoId: string; ordem: number }>(
  chamadas: T[],
): Map<string, T[]> {
  const porExecucao = new Map<string, T[]>();
  for (const c of [...chamadas].sort((a, b) => a.ordem - b.ordem)) {
    const lista = porExecucao.get(c.execucaoId) ?? [];
    lista.push(c);
    porExecucao.set(c.execucaoId, lista);
  }
  return porExecucao;
}

/** Item abaixo do limite de confiança é o que a tela destaca (regra de revisão da ingestão). */
export function abaixoDoLimite(confianca: number, limite: number): boolean {
  return confianca < limite;
}

/** Versão do painel: o instante mais recente entre execuções, nota e decisões. */
export function versaoDoPainel(instantes: Array<Date | null | undefined>): string {
  const validos = instantes.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  return validos.length === 0 ? "0" : String(Math.max(...validos));
}

export type { ChamadaBastidores, DecisaoAlerta, ItemBastidores, PainelBastidores };
