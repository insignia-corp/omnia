import {
  combinarProcedencias,
  dadoAusente,
  ehDadoAusente,
  procedenciaDeUmRegistro,
  resultadoMetrica,
  type Procedencia,
} from "./resultado-metrica";

describe("resultado-metrica", () => {
  describe("dadoAusente", () => {
    it("carrega código, motivo e a pergunta ao dono", () => {
      expect(dadoAusente("sem_custo", "Sem nota de compra.", "Qual o custo?")).toEqual({
        ausente: true,
        codigo: "sem_custo",
        motivo: "Sem nota de compra.",
        pergunta_sugerida: "Qual o custo?",
      });
    });

    it("omite a pergunta quando não há", () => {
      expect(dadoAusente("sem_venda", "Sem venda.")).not.toHaveProperty("pergunta_sugerida");
    });
  });

  describe("ehDadoAusente", () => {
    it("reconhece o dado ausente e só ele", () => {
      expect(ehDadoAusente(dadoAusente("x", "y"))).toBe(true);
      expect(ehDadoAusente({ valor: 1, ausente: false })).toBe(false);
      expect(ehDadoAusente(resultadoMetrica(1, { inicio: "a", fim: "b" }, []))).toBe(false);
      expect(ehDadoAusente(null)).toBe(false);
      expect(ehDadoAusente("ausente")).toBe(false);
    });
  });

  describe("combinarProcedencias", () => {
    const venda = (registros: number, confianca: number | null): Procedencia => ({
      registros,
      menorConfianca: confianca,
      origens: ["planilha"],
    });

    it("soma registros, pega a menor confiança e junta as origens em ordem alfabética", () => {
      const r = combinarProcedencias([
        venda(10, 1),
        procedenciaDeUmRegistro("foto_nota", 0.5),
        procedenciaDeUmRegistro("dono", 0.9),
        venda(3, 0.8),
      ]);
      expect(r).toEqual({
        n_registros: 15,
        menor_confianca: 0.5,
        origens: ["dono", "foto_nota", "planilha"],
      });
    });

    it("ignora fonte sem confiança informada", () => {
      expect(combinarProcedencias([venda(2, null), venda(1, 0.7)]).menor_confianca).toBe(0.7);
    });

    it("sem fontes: zero registros e confiança nula", () => {
      expect(combinarProcedencias([])).toEqual({ n_registros: 0, menor_confianca: null, origens: [] });
    });

    it("não repete origem", () => {
      expect(combinarProcedencias([venda(1, 1), venda(1, 1)]).origens).toEqual(["planilha"]);
    });
  });

  it("resultadoMetrica junta valor, período e procedência", () => {
    const periodo = { inicio: "2026-09-20", fim: "2026-10-19" };
    expect(resultadoMetrica({ margem_bps: 2026 }, periodo, [venda1()])).toEqual({
      valor: { margem_bps: 2026 },
      periodo,
      n_registros: 1,
      menor_confianca: 0.6,
      origens: ["nfe"],
    });
  });
});

function venda1(): Procedencia {
  return procedenciaDeUmRegistro("nfe", 0.6);
}
