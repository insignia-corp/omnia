import { dataLocal, minutosDoDia, relogioComDataFixa, type Relogio } from "./relogio";

describe("relogio", () => {
  const fuso = "America/Sao_Paulo";

  it("usa a data local, não a de UTC", () => {
    // 23h30 em São Paulo (UTC-3) já é o dia seguinte em UTC.
    const agora = new Date("2026-10-21T02:30:00Z");
    expect(dataLocal(agora, fuso)).toBe("2026-10-20");
    expect(agora.toISOString().slice(0, 10)).toBe("2026-10-21");
  });

  it("calcula os minutos do dia no fuso", () => {
    expect(minutosDoDia(new Date("2026-10-21T02:30:00Z"), fuso)).toBe(23 * 60 + 30);
    expect(minutosDoDia(new Date("2026-10-20T03:00:00Z"), fuso)).toBe(0);
  });
});

describe("relogioComDataFixa", () => {
  const fuso = "America/Sao_Paulo";
  const base = (iso: string): Relogio => ({ agora: () => new Date(iso) });

  it("usa a data fixa com a hora real do fuso", () => {
    // 15h30 em São Paulo no dia 24/10; a demo trava a data em 20/10.
    const agora = relogioComDataFixa("2026-10-20", fuso, base("2026-10-24T18:30:00Z")).agora();
    expect(dataLocal(agora, fuso)).toBe("2026-10-20");
    expect(minutosDoDia(agora, fuso)).toBe(15 * 60 + 30);
  });

  it("mantém a data fixa mesmo quando a hora real já virou o dia em UTC", () => {
    // 23h30 em São Paulo é 02h30 do dia seguinte em UTC.
    const agora = relogioComDataFixa("2026-10-20", fuso, base("2026-10-25T02:30:00Z")).agora();
    expect(dataLocal(agora, fuso)).toBe("2026-10-20");
    expect(minutosDoDia(agora, fuso)).toBe(23 * 60 + 30);
  });
});
