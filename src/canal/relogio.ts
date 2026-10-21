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

/**
 * Relógio da demo: a data é a fixa, a hora do dia é a real. Assim as métricas olham o período dos
 * dados de teste e o horário de silêncio continua valendo.
 */
export function relogioComDataFixa(data: string, fuso: string, base: Relogio = relogioDoSistema): Relogio {
  return {
    agora(): Date {
      const real = base.agora();
      const minutos = minutosDoDia(real, fuso);
      const segundos = real.getUTCSeconds() * 1000 + real.getUTCMilliseconds();
      const meiaNoiteUtc = Date.parse(`${data}T00:00:00Z`);
      // Minutos locais da meia-noite UTC dessa data: diz de quanto o fuso difere de UTC.
      const local = minutosDoDia(new Date(meiaNoiteUtc), fuso);
      const mesmoDia = dataLocal(new Date(meiaNoiteUtc), fuso) === data;
      const meiaNoiteLocal = mesmoDia
        ? meiaNoiteUtc - local * 60_000
        : meiaNoiteUtc + (1440 - local) * 60_000;
      return new Date(meiaNoiteLocal + minutos * 60_000 + segundos);
    },
  };
}
