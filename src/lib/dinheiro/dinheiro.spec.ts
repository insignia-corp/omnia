import {
  centavos,
  ErroDinheiro,
  formatarBRL,
  multiplicar,
  parseCentavos,
  parseDecimalNfe,
  razao,
  somar,
  subtrair,
  ZERO,
} from "./dinheiro";

describe("dinheiro", () => {
  describe("centavos", () => {
    it("aceita inteiros", () => expect(centavos(1290)).toBe(1290));
    it.each([12.9, Number.NaN, Infinity, 2 ** 60])("rejeita %p", (v) => {
      expect(() => centavos(v)).toThrow(ErroDinheiro);
    });
  });

  it("soma e subtrai", () => {
    expect(somar(centavos(100), centavos(250), centavos(5))).toBe(355);
    expect(somar()).toBe(ZERO);
    expect(subtrair(centavos(100), centavos(250))).toBe(-150);
  });

  describe("multiplicar", () => {
    it("quantidade inteira", () => expect(multiplicar(centavos(1290), 3)).toBe(3870));
    it("quantidade fracionária arredonda meio para cima", () => {
      expect(multiplicar(centavos(999), 1.5)).toBe(1499); // 1498,5
      expect(multiplicar(centavos(1), 0.5)).toBe(1);
      expect(multiplicar(centavos(-999), 1.5)).toBe(-1499);
    });
    it("corrige ruído de ponto flutuante", () => expect(multiplicar(centavos(201), 0.5)).toBe(101));
    it("rejeita quantidade inválida", () => expect(() => multiplicar(centavos(1), Number.NaN)).toThrow());
  });

  it("razão devolve null com divisor zero", () => {
    expect(razao(centavos(25), centavos(100))).toBe(0.25);
    expect(razao(centavos(25), ZERO)).toBeNull();
  });

  describe("parseCentavos", () => {
    it.each([
      ["12,90", 1290],
      ["R$ 1.234,50", 123450],
      ["R$1.234,5", 123450],
      ["1234.5", 123450],
      ["1234.56", 123456],
      ["1.234", 123400],
      ["1.234.567", 123456700],
      ["0,05", 5],
      ["-3,00", -300],
      ["15", 1500],
      [" 7,9 ", 790],
    ])("%p vira %p", (texto, esperado) => expect(parseCentavos(texto)).toBe(esperado));

    it.each(["", "abc", "12,345", "1,2,3", "R$", "12a"])("rejeita %p", (texto) => {
      expect(() => parseCentavos(texto)).toThrow(ErroDinheiro);
    });
  });

  it("formata em BRL", () => {
    expect(formatarBRL(centavos(123450))).toBe("R$ 1.234,50");
    expect(formatarBRL(centavos(5))).toBe("R$ 0,05");
  });

  describe("parseDecimalNfe", () => {
    it.each([
      ["139.20", 13920],
      ["5.800000", 580],
      ["5.805", 581],
      ["5.804", 580],
      ["0.0049", 0],
      ["12", 1200],
    ])("%p vira %p", (texto, esperado) => expect(parseDecimalNfe(texto)).toBe(esperado));

    it.each(["1e3", "-1", "1,5", "", "abc", "1.2.3", ".5"])("recusa %p", (texto) =>
      expect(() => parseDecimalNfe(texto)).toThrow(ErroDinheiro),
    );
  });
});
