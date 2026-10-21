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
 * Versão do painel: o instante mais recente entre execuções e nota, mais uma impressão das decisões de
 * alerta. A tabela `alerta` não tem data de atualização, e status e justificativa mudam sem execução
 * nova; sem a impressão, a tela descartaria a resposta por ter a mesma versão.
 */
export function versaoDoPainel(
  instantes: Array<Date | null | undefined>,
  decisoes: DecisaoAlerta[] = [],
): string {
  const validos = instantes.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  const base = validos.length === 0 ? "0" : String(Math.max(...validos));
  if (decisoes.length === 0) return base;
  const campos = [...decisoes]
    .sort((a, b) => a.alerta_id.localeCompare(b.alerta_id))
    .map((d) => [d.alerta_id, d.status, d.prioridade, d.justificativa, d.execucao_id]);
  return `${base}.${createHash("sha256").update(JSON.stringify(campos)).digest("hex").slice(0, 16)}`;
}

export type { ChamadaBastidores, DecisaoAlerta, ItemBastidores, PainelBastidores };
