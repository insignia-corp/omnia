import { LIMITES_PADRAO } from "./limites";
import { compararCandidatos, ordenarGravados, prioridadeDe } from "./prioridade";
import type { CandidatoDeAlerta } from "./regra";
import type { Prioridade } from "./tipos";

const candidato = (
  extra: Partial<CandidatoDeAlerta & { prioridade: Prioridade }> = {},
): CandidatoDeAlerta & { prioridade: Prioridade } => ({
  tipo: "margem_abaixo_da_meta",
  chave: "a",
  produtoId: null,
  fornecedorId: null,
  metricasApoio: {},
  impactoCentavos: 0,
  confianca: 1,
  prioridade: 3,
  ...extra,
});

describe("prioridadeDe", () => {
  it.each([
    [50_000, 1],
    [49_999, 2],
    [10_000, 2],
    [9_999, 3],
    [0, 3],
  ])("impacto de %i centavos dá prioridade %i", (impactoCentavos, esperada) => {
    expect(prioridadeDe({ impactoCentavos, confianca: 1 }, LIMITES_PADRAO)).toBe(esperada);
  });

  it("sem impacto medido fica no nível mais baixo", () => {
    expect(prioridadeDe({ impactoCentavos: null, confianca: 1 }, LIMITES_PADRAO)).toBe(3);
  });

  it("confiança abaixo do mínimo rebaixa um nível, sem passar do 3", () => {
    expect(prioridadeDe({ impactoCentavos: 60_000, confianca: 0.79 }, LIMITES_PADRAO)).toBe(2);
    expect(prioridadeDe({ impactoCentavos: 20_000, confianca: 0.79 }, LIMITES_PADRAO)).toBe(3);
    expect(prioridadeDe({ impactoCentavos: 0, confianca: 0.1 }, LIMITES_PADRAO)).toBe(3);
  });

  it("confiança no mínimo não rebaixa, mas desconhecida vale como baixa", () => {
    expect(prioridadeDe({ impactoCentavos: 60_000, confianca: 0.8 }, LIMITES_PADRAO)).toBe(1);
    expect(prioridadeDe({ impactoCentavos: 60_000, confianca: null }, LIMITES_PADRAO)).toBe(2);
  });

  it("respeita os limites do comerciante", () => {
    const limites = { ...LIMITES_PADRAO, prioridade1MinCentavos: 1_000 };
    expect(prioridadeDe({ impactoCentavos: 1_000, confianca: 1 }, limites)).toBe(1);
  });
});

describe("compararCandidatos", () => {
  it("ordena por prioridade, depois impacto, depois confiança, depois tipo e chave", () => {
    const lista = [
      candidato({ chave: "e", prioridade: 3, impactoCentavos: null }),
      candidato({ chave: "d", prioridade: 2, impactoCentavos: 100, confianca: 0.9 }),
      candidato({ chave: "c", prioridade: 2, impactoCentavos: 100, confianca: 1 }),
      candidato({ chave: "b", prioridade: 2, impactoCentavos: 900 }),
      candidato({ chave: "a", prioridade: 1, impactoCentavos: 1 }),
      candidato({ chave: "a", tipo: "estoque_parado", prioridade: 2, impactoCentavos: 100, confianca: 1 }),
    ];
    const ordem = lista.sort(compararCandidatos).map((c) => `${c.tipo}:${c.chave}`);
    expect(ordem).toEqual([
      "margem_abaixo_da_meta:a",
      "margem_abaixo_da_meta:b",
      "estoque_parado:a",
      "margem_abaixo_da_meta:c",
      "margem_abaixo_da_meta:d",
      "margem_abaixo_da_meta:e",
    ]);
  });

  it("é determinístico: a ordem de entrada não muda a saída", () => {
    const a = candidato({ chave: "x", impactoCentavos: 5 });
    const b = candidato({ chave: "y", impactoCentavos: 5 });
    expect([a, b].sort(compararCandidatos)).toEqual([b, a].sort(compararCandidatos));
  });
});

describe("ordenarGravados", () => {
  const gravado = (
    chave: string,
    prioridade: Prioridade,
    impacto: number | null,
    confianca: number | null = 1,
  ) => ({
    id: chave,
    tipo: "margem_abaixo_da_meta" as const,
    chave,
    prioridade,
    dataReferencia: "2026-10-19",
    produtoId: null,
    fornecedorId: null,
    metricasApoio: { impacto_centavos: impacto, confianca },
  });

  it("devolve na ordem do critério, lendo impacto e confiança das métricas de apoio", () => {
    const lista = [gravado("c", 3, null), gravado("b", 2, 100), gravado("a", 2, 450), gravado("d", 1, 1)];
    expect(ordenarGravados(lista).map((l) => l.chave)).toEqual(["d", "a", "b", "c"]);
  });
});
