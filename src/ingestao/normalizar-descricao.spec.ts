import { normalizarDescricao } from "./normalizar-descricao";

describe("normalizarDescricao", () => {
  it.each([
    ["Pão  de forma 500g ", "PAO DE FORMA 500G"],
    ["REFRIG COLA 2L", "REFRIG COLA 2L"],
    ["Óleo de soja\t900ml", "OLEO DE SOJA 900ML"],
    ["", ""],
  ])("%j vira %j", (entrada, esperado) => {
    expect(normalizarDescricao(entrada)).toBe(esperado);
  });
});
