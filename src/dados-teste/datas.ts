/** Datas ISO (AAAA-MM-DD) sem fuso: toda conta é em UTC para não variar com a máquina. */

const DIA_MS = 86_400_000;

export function paraTimestamp(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

export function somarDias(iso: string, dias: number): string {
  return new Date(paraTimestamp(iso) + dias * DIA_MS).toISOString().slice(0, 10);
}

export function diferencaEmDias(deIso: string, ateIso: string): number {
  return Math.round((paraTimestamp(ateIso) - paraTimestamp(deIso)) / DIA_MS);
}

/** 0 = domingo ... 6 = sábado. */
export function diaDaSemana(iso: string): number {
  return new Date(paraTimestamp(iso)).getUTCDay();
}

/** Todas as datas de `inicio` a `fim`, inclusive. */
export function intervalo(inicio: string, fim: string): string[] {
  const datas: string[] = [];
  for (let d = inicio; d <= fim; d = somarDias(d, 1)) datas.push(d);
  return datas;
}

/** "2026-10-19" vira "19/10/2026", como numa planilha de lojista. */
export function formatarDataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
