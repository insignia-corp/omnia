import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ErroDeCusto } from "./amostras";

/** "0,0068" ou "0.0068" em dólares vira micro-dólares inteiros, sem passar por ponto flutuante. */
export function microdolaresDe(texto: string, flag: string): number {
  const m = /^(\d+)(?:[.,](\d{1,6}))?$/.exec(texto.trim());
  if (!m)
    throw new ErroDeCusto(`${flag} deve ser um valor em dólares, como 0.0068 ou 2500; recebi "${texto}".`);
  return Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
}

export function inteiroPositivo(texto: string, flag: string): number {
  if (!/^\d+$/.test(texto) || Number(texto) < 1)
    throw new ErroDeCusto(`${flag} deve ser um inteiro maior que zero; recebi "${texto}".`);
  return Number(texto);
}

/** O arquivo mais recente de `evidencias/` cujo nome casa com `padrao`; os nomes começam pela data e pela hora. */
export function maisRecente(dir: string, padrao: RegExp): string | null {
  if (!existsSync(dir)) return null;
  const nomes = readdirSync(dir)
    .filter((n) => padrao.test(n))
    .sort();
  const ultimo = nomes.at(-1);
  return ultimo ? path.join(dir, ultimo) : null;
}

/** Saída bruta do agente: `AAAA-MM-DD-eval-real-<hora>.json`; a da extração: `AAAA-MM-DD-eval-extracao-real-<hora>.json`. */
export const PADRAO_AGENTE_REAL = /^\d{4}-\d{2}-\d{2}-eval-real-\d+(-\d+)?\.json$/;
export const PADRAO_EXTRACAO_REAL = /^\d{4}-\d{2}-\d{2}-eval-extracao-real-\d+(-\d+)?\.json$/;
