import { dividirArredondando, percentualDeBps, razaoEmBps } from "./pontos-base";

describe("pontos-base", () => {
  describe("dividirArredondando", () => {
    it("arredonda para o inteiro mais próximo", () => {
      expect(dividirArredondando(10, 4)).toBe(3); // 2,5
      expect(dividirArredondando(9, 4)).toBe(2); // 2,25
      expect(dividirArredondando(11, 4)).toBe(3); // 2,75
    });

    it("o meio vai para longe do zero, também nos negativos", () => {
      expect(dividirArredondando(-10, 4)).toBe(-3);
      expect(dividirArredondando(10, -4)).toBe(-3);
      expect(dividirArredondando(-10, -4)).toBe(3);
    });

    it("divisão exata e zero", () => {
      expect(dividirArredondando(12, 4)).toBe(3);
      expect(dividirArredondando(0, 7)).toBe(0);
      expect(Object.is(dividirArredondando(-1, 3), -0)).toBe(false);
    });

    it("null com divisor zero e erro com valor que não é número finito", () => {
      expect(dividirArredondando(1, 0)).toBeNull();
      expect(() => dividirArredondando(Number.NaN, 1)).toThrow(RangeError);
    });
  });

  describe("razaoEmBps", () => {
    it("calcula a razão em bps", () => {
      expect(razaoEmBps(25, 100)).toBe(2500);
      expect(razaoEmBps(1, 3)).toBe(3333);
      expect(razaoEmBps(2, 3)).toBe(6667);
    });

    it("arredonda meio para cima", () => {
      expect(razaoEmBps(1, 20_000)).toBe(1); // 0,5 bps
      expect(razaoEmBps(3, 20_000)).toBe(2); // 1,5 bps
    });

    it("arredonda o meio afastando do zero também nos negativos", () => {
      expect(razaoEmBps(-1, 20_000)).toBe(-1);
      expect(razaoEmBps(-3, 20_000)).toBe(-2);
      expect(razaoEmBps(1, -20_000)).toBe(-1);
      expect(razaoEmBps(-1, -20_000)).toBe(1);
    });

    it("não devolve zero negativo", () => {
      expect(Object.is(razaoEmBps(-1, 100_000), 0)).toBe(true);
      expect(Object.is(razaoEmBps(0, 5), 0)).toBe(true);
    });

    it("aceita razões acima de 100% e negativas", () => {
      expect(razaoEmBps(3, 2)).toBe(15_000);
      expect(razaoEmBps(-5, 100)).toBe(-500);
    });

    it("devolve null com divisor zero", () => expect(razaoEmBps(5, 0)).toBeNull());

    it("recusa valores que não são números finitos", () => {
      expect(() => razaoEmBps(Number.NaN, 1)).toThrow(RangeError);
      expect(() => razaoEmBps(1, Infinity)).toThrow(RangeError);
    });

    it("bate com os casos do gabarito (arroz P01 e café P05)", () => {
      expect(razaoEmBps(3499 - 2790, 3499)).toBe(2026); // margem 20,26%
      expect(razaoEmBps(2790 - 2490, 2490)).toBe(1205); // reajuste de 12,05%
      expect(razaoEmBps(1250 - 1290, 1290)).toBe(-310); // queda de 3,10%
    });
  });

  describe("percentualDeBps", () => {
    it("converte para percentual de exibição", () => {
      expect(percentualDeBps(2026)).toBe(20.26);
      expect(percentualDeBps(-310)).toBe(-3.1);
      expect(percentualDeBps(0)).toBe(0);
    });

    it("dá o mesmo número que o verificador lê em '20,26%'", () => {
      expect(percentualDeBps(2026)).toBe(Number("20.26"));
      expect(percentualDeBps(1205)).toBe(Number("12.05"));
    });
  });
});
