import { emSilencio, fimDoSilencio } from "./horario-silencio";

const noturna = { inicio: "22:00", fim: "07:00" };
const h = (hora: number, min = 0) => hora * 60 + min;

describe("emSilencio", () => {
  it("vale dentro da janela que vira a meia-noite", () => {
    expect(emSilencio(h(23), noturna)).toBe(true);
    expect(emSilencio(h(3), noturna)).toBe(true);
    expect(emSilencio(h(22), noturna)).toBe(true);
  });

  it("não vale fora da janela, e o fim é exclusivo", () => {
    expect(emSilencio(h(8), noturna)).toBe(false);
    expect(emSilencio(h(7), noturna)).toBe(false);
    expect(emSilencio(h(21, 59), noturna)).toBe(false);
  });

  it("trata janela dentro do mesmo dia", () => {
    const tarde = { inicio: "13:00", fim: "15:00" };
    expect(emSilencio(h(14), tarde)).toBe(true);
    expect(emSilencio(h(15), tarde)).toBe(false);
  });

  it("início igual ao fim desliga o silêncio", () => {
    expect(emSilencio(h(3), { inicio: "00:00", fim: "00:00" })).toBe(false);
  });
});

describe("fimDoSilencio", () => {
  it("aponta para o fim da janela, mesmo virando o dia", () => {
    // 23h30 em São Paulo (02:30Z): o silêncio acaba às 07h locais, 10:00Z.
    const agora = new Date("2026-10-21T02:30:15Z");
    expect(fimDoSilencio(agora, h(23, 30), noturna).toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });
});
