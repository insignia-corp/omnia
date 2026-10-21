import { createHash } from "node:crypto";
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

/**
 * Versão do painel: resumo do conteúdo inteiro (execuções, nota e decisões de alerta, com status e
 * justificativa). A página só redesenha quando muda, então qualquer campo que mude tem de mudar a versão.
 */
export function versaoDoPainel(conteudo: unknown): string {
  return createHash("sha1").update(JSON.stringify(conteudo)).digest("hex").slice(0, 16);
}

export type { ChamadaBastidores, DecisaoAlerta, ItemBastidores, PainelBastidores };
