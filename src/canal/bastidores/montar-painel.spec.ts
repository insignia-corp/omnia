import { abaixoDoLimite, agruparChamadas, versaoDoPainel } from "./montar-painel";

describe("agruparChamadas", () => {
  it("agrupa por execução e ordena pela ordem da chamada", () => {
    const grupos = agruparChamadas([
      { execucaoId: "e1", ordem: 2 },
      { execucaoId: "e2", ordem: 1 },
      { execucaoId: "e1", ordem: 1 },
    ]);
    expect(grupos.get("e1")!.map((c) => c.ordem)).toEqual([1, 2]);
    expect(grupos.get("e2")).toHaveLength(1);
  });
});

describe("abaixoDoLimite", () => {
  it("só o que fica abaixo do limite é destacado", () => {
    expect(abaixoDoLimite(0.79, 0.8)).toBe(true);
    expect(abaixoDoLimite(0.8, 0.8)).toBe(false);
  });
});

describe("versaoDoPainel", () => {
  it("usa o instante mais recente e ignora vazios", () => {
    const v = versaoDoPainel([new Date(1000), null, new Date(5000), undefined]);
    expect(v).toBe("5000");
  });

  it("é '0' sem nada", () => {
    expect(versaoDoPainel([null])).toBe("0");
  });
});
