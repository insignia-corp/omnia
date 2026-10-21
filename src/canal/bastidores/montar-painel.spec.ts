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
  it("o mesmo conteúdo dá a mesma versão", () => {
    expect(versaoDoPainel({ a: 1, b: [2] })).toBe(versaoDoPainel({ a: 1, b: [2] }));
  });

  it("qualquer campo que muda muda a versão, inclusive status e justificativa de um alerta", () => {
    const base = { decisoes: [{ status: "candidato", justificativa: null }] };
    const status = { decisoes: [{ status: "enviado", justificativa: null }] };
    const justificativa = { decisoes: [{ status: "candidato", justificativa: "maior variação" }] };
    expect(versaoDoPainel(status)).not.toBe(versaoDoPainel(base));
    expect(versaoDoPainel(justificativa)).not.toBe(versaoDoPainel(base));
  });
});
