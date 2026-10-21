export const RELOGIO = Symbol("RELOGIO");

/** Relógio injetável: o job e o horário de silêncio dependem da hora, e o teste precisa controlá-la. */
export interface Relogio {
  agora(): Date;
}

export const relogioDoSistema: Relogio = { agora: () => new Date() };

/** Data local "AAAA-MM-DD" no fuso (às 23h30 em São Paulo ainda é o dia anterior ao de UTC). */
export function dataLocal(agora: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** Minutos desde a meia-noite local (0 a 1439). */
export function minutosDoDia(agora: Date, fuso: string): number {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: fuso,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(agora);
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  return valor("hour") * 60 + valor("minute");
}
