import { arredondarQuantidade, somarQuantidades } from "./quantidades";

describe("quantidades", () => {
  it("soma inteiros", () => expect(somarQuantidades([1, 2, 3])).toBe(6));

  it("remove o ruído de ponto flutuante", () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(somarQuantidades([0.1, 0.2])).toBe(0.3);
    expect(somarQuantidades(Array.from({ length: 56 }, () => 0.1))).toBe(5.6);
  });

  it("mantém as 3 casas de kg", () => expect(somarQuantidades([0.35, 1.275, 2.5])).toBe(4.125));

  it("soma vazia é zero", () => expect(somarQuantidades([])).toBe(0));

  it("arredonda para 3 casas", () => expect(arredondarQuantidade(1.23449)).toBe(1.234));
});
