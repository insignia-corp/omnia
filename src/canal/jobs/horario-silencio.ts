export interface JanelaSilencio {
  /** HH:MM */
  inicio: string;
  /** HH:MM */
  fim: string;
}

const DIA = 24 * 60;

function paraMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A janela pode virar a meia-noite (22:00 a 07:00). Início igual ao fim desliga o silêncio. */
export function emSilencio(minutosDoDia: number, janela: JanelaSilencio): boolean {
  const inicio = paraMinutos(janela.inicio);
  const fim = paraMinutos(janela.fim);
  if (inicio === fim) return false;
  return inicio < fim
    ? minutosDoDia >= inicio && minutosDoDia < fim
    : minutosDoDia >= inicio || minutosDoDia < fim;
}

/** Próximo instante em que o silêncio acaba, a partir de `agora` (já dentro da janela). */
export function fimDoSilencio(agora: Date, minutosDoDia: number, janela: JanelaSilencio): Date {
  const falta = (paraMinutos(janela.fim) - minutosDoDia + DIA) % DIA;
  const segundosDoMinuto = agora.getUTCSeconds() * 1000 + agora.getUTCMilliseconds();
  return new Date(agora.getTime() - segundosDoMinuto + falta * 60_000);
}
