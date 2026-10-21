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

/** JSON com chaves em ordem, para a mesma decisão dar sempre a mesma impressão (jsonb não garante ordem de leitura). */
function canonico(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(canonico);
  if (v !== null && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
    );
  return v;
}

/**
 * Versão do painel: o instante mais recente entre execuções e nota, mais uma impressão das decisões de
 * alerta. A tabela `alerta` não tem data de atualização, e status, justificativa e métricas mudam sem
 * execução nova; a impressão cobre a decisão inteira, com as chaves em ordem, então qualquer campo
 * exibido que mude muda a versão. Sem ela, a tela descartaria a resposta por ter a mesma versão.
 */
export function versaoDoPainel(
  instantes: Array<Date | null | undefined>,
  decisoes: DecisaoAlerta[] = [],
): string {
  const validos = instantes.filter((d): d is Date => d instanceof Date).map((d) => d.getTime());
  const base = validos.length === 0 ? "0" : String(Math.max(...validos));
  if (decisoes.length === 0) return base;
  const campos = [...decisoes].sort((a, b) => a.alerta_id.localeCompare(b.alerta_id)).map(canonico);
  return `${base}.${createHash("sha256").update(JSON.stringify(campos)).digest("hex").slice(0, 16)}`;
}

export type { ChamadaBastidores, DecisaoAlerta, ItemBastidores, PainelBastidores };
