import { estatisticaDoGatilho, estatisticas, percentil, type Amostra } from "./estatisticas";

const a = (gatilho: Amostra["gatilho"], custo: number | null, ms: number, aprovada = true): Amostra => ({
  gatilho,
  custoMicrodolares: custo,
  latenciaMs: ms,
  modelo: "claude-sonnet-5-5",
  aprovada,
});

describe("percentil", () => {
  it("posto mais próximo, sem interpolar: o valor sempre existe na amostra", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentil(v, 50)).toBe(50);
    expect(percentil(v, 95)).toBe(100);
    expect(percentil(v, 10)).toBe(10);
    expect(percentil(v, 100)).toBe(100);
  });

  it("não depende da ordem de entrada e não a altera", () => {
    const v = [30, 10, 20];
    expect(percentil(v, 50)).toBe(20);
    expect(v).toEqual([30, 10, 20]);
  });

  it("uma amostra só vale para qualquer percentil; lista vazia dá zero", () => {
    expect(percentil([7], 95)).toBe(7);
    expect(percentil([], 50)).toBe(0);
  });

  it("recusa percentil fora de (0, 100]", () => {
    expect(() => percentil([1], 0)).toThrow();
    expect(() => percentil([1], 101)).toThrow();
  });
});

describe("estatisticaDoGatilho", () => {
  it("separa por gatilho e calcula média inteira, p50, p95 e máximo", () => {
    const amostras = [
      a("mensagem_dono", 40_000, 2000),
      a("mensagem_dono", 60_000, 4000),
      a("mensagem_dono", 50_001, 30_000),
      a("relatorio_diario", 100_000, 9000),
    ];
    expect(estatisticaDoGatilho("mensagem_dono", amostras)).toEqual({
      gatilho: "mensagem_dono",
      execucoes: 3,
      semAprovacao: 0,
      custoMedioMicrodolares: 50_000,
      latenciaP50Ms: 4000,
      latenciaP95Ms: 30_000,
      latenciaMaximaMs: 30_000,
    });
    expect(estatisticaDoGatilho("relatorio_diario", amostras).custoMedioMicrodolares).toBe(100_000);
  });

  it("uma execução sem custo (modelo sem preço) deixa a média indisponível, não zero", () => {
    const e = estatisticaDoGatilho("extracao_nota", [
      a("extracao_nota", 9000, 4000),
      a("extracao_nota", null, 5000),
    ]);
    expect(e.custoMedioMicrodolares).toBeNull();
    expect(e.latenciaP50Ms).toBe(4000);
  });

  it("conta as execuções que o verificador não aprovou, e elas entram na média e no tempo", () => {
    const e = estatisticaDoGatilho("mensagem_dono", [
      a("mensagem_dono", 20_000, 5000),
      a("mensagem_dono", 40_000, 20_000, false),
    ]);
    expect(e).toMatchObject({
      execucoes: 2,
      semAprovacao: 1,
      custoMedioMicrodolares: 30_000,
      latenciaP95Ms: 20_000,
    });
  });

  it("gatilho sem amostra: zero execuções e custo indisponível", () => {
    expect(estatisticaDoGatilho("relatorio_diario", [])).toMatchObject({
      execucoes: 0,
      custoMedioMicrodolares: null,
    });
  });

  it("estatisticas devolve os três gatilhos, na ordem", () => {
    expect(estatisticas([]).map((e) => e.gatilho)).toEqual([
      "relatorio_diario",
      "mensagem_dono",
      "extracao_nota",
    ]);
  });
});
