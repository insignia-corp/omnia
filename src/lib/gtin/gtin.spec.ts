import { normalizarGtin } from "./gtin";

describe("normalizarGtin", () => {
  it.each(["2990000000019", "2990000000385", "7891000100103", "96385074", "036000291452", "10012345678902"])(
    "aceita o GTIN válido %p",
    (codigo) => expect(normalizarGtin(codigo)).toBe(codigo),
  );

  it("aceita espaços ao redor", () => {
    expect(normalizarGtin(" 7891000100103 ")).toBe("7891000100103");
  });

  it.each(["7891000100104", "SEM GTIN", "", "   ", "123", "789100010010A", "78910001001031"])(
    "recusa %p",
    (codigo) => expect(normalizarGtin(codigo)).toBeNull(),
  );

  it("recusa nulo e indefinido", () => {
    expect(normalizarGtin(null)).toBeNull();
    expect(normalizarGtin(undefined)).toBeNull();
  });
});
