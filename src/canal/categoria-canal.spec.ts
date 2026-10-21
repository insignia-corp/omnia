import { categoriaDoCanal } from "./categoria-canal";

describe("categoriaDoCanal", () => {
  it.each([
    ["utility", "utilidade"],
    ["service", "servico"],
    ["authentication", "autenticacao"],
    ["marketing", "marketing"],
    ["Utilidade", "utilidade"],
    ["serviço", "servico"],
    [" MARKETING ", "marketing"],
  ])("%p vira %p", (entrada, esperado) => expect(categoriaDoCanal(entrada)).toBe(esperado));

  it("valor desconhecido ou vazio vira nulo", () => {
    expect(categoriaDoCanal("outra")).toBeNull();
    expect(categoriaDoCanal(null)).toBeNull();
    expect(categoriaDoCanal(undefined)).toBeNull();
  });
});
