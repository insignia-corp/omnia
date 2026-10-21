/**
 * Datas ISO ("2026-10-19") como texto. A aritmética é em UTC, então não muda com o fuso do
 * servidor nem com o horário de verão. Este módulo não depende do resto da aplicação.
 */

const MS_POR_DIA = 86_400_000;
const PADRAO_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export class ErroData extends Error {}

function paraUtc(data: string): number {
  const partes = PADRAO_ISO.exec(data);
  if (!partes) throw new ErroData(`Data inválida, esperado AAAA-MM-DD: "${data}"`);
  const [, ano = "", mes = "", dia = ""] = partes;
  const ms = Date.UTC(Number(ano), Number(mes) - 1, Number(dia));
  // O Date rola 2026-02-30 para março; a ida e volta recusa a data que não existe.
  if (new Date(ms).toISOString().slice(0, 10) !== data) {
    throw new ErroData(`Data inexistente: "${data}"`);
  }
  return ms;
}

/** Soma (ou subtrai, se negativo) dias a uma data ISO. */
export function somarDias(data: string, dias: number): string {
  if (!Number.isInteger(dias)) throw new ErroData(`Dias precisam ser inteiros, recebido: ${dias}`);
  return new Date(paraUtc(data) + dias * MS_POR_DIA).toISOString().slice(0, 10);
}

/** Dias de `de` até `ate`: positivo quando `ate` vem depois. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / MS_POR_DIA);
}

/** Todas as datas de `inicio` a `fim`, inclusive. Vazio quando `fim` vem antes de `inicio`. */
export function intervaloDeDatas(inicio: string, fim: string): string[] {
  const dias = diasEntre(inicio, fim);
  return Array.from({ length: Math.max(0, dias + 1) }, (_, i) => somarDias(inicio, i));
}
