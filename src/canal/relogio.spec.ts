import { dataLocal, minutosDoDia } from "./relogio";

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
