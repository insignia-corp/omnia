import type { VendasDoDia } from "./dados-de-metricas";
import { calcularResumoDePeriodo } from "./resumo-de-periodo";
import { calcularSerieDeFaturamento } from "./serie-de-faturamento";

const venda = (data: string, faturamentoCentavos: number, menorConfianca = 1): VendasDoDia => ({
  data,
  cupons: 3,
  faturamentoCentavos,
  registros: 3,
  menorConfianca,
  origens: ["planilha"],
});

describe("calcularSerieDeFaturamento", () => {
  it("semana: os 7 dias que terminam na data, na ordem, com o faturamento de cada um", () => {
    const vendas = [venda("2026-10-17", 1_000), venda("2026-10-20", 2_550, 0.9), venda("2026-10-23", 99)];
    const r = calcularSerieDeFaturamento({
      tipo: "semana",
      ate: "2026-10-23",
      vendas,
      intervaloDeVendas: { primeira: "2026-10-01", ultima: "2026-10-23" },
    });
    expect(r.periodo).toEqual({ inicio: "2026-10-17", fim: "2026-10-23" });
    expect(r.valor).toEqual([
      { data: "2026-10-17", faturamento_centavos: 1_000 },
      { data: "2026-10-18", faturamento_centavos: 0 },
      { data: "2026-10-19", faturamento_centavos: 0 },
      { data: "2026-10-20", faturamento_centavos: 2_550 },
      { data: "2026-10-21", faturamento_centavos: 0 },
      { data: "2026-10-22", faturamento_centavos: 0 },
      { data: "2026-10-23", faturamento_centavos: 99 },
    ]);
    expect(r.n_registros).toBe(9);
    expect(r.menor_confianca).toBe(0.9);
    expect(r.origens).toEqual(["planilha"]);
  });

  it("dia fora das vendas importadas é nulo (lacuna), nunca zero", () => {
    const r = calcularSerieDeFaturamento({
      tipo: "semana",
      ate: "2026-10-23",
      vendas: [venda("2026-10-20", 500), venda("2026-10-21", 700)],
      intervaloDeVendas: { primeira: "2026-10-20", ultima: "2026-10-21" },
    });
    expect(r.valor.map((d) => d.faturamento_centavos)).toEqual([null, null, null, 500, 700, null, null]);
  });

  it("sem nenhuma venda importada, todos os dias são nulos e não há registro", () => {
    const r = calcularSerieDeFaturamento({
      tipo: "semana",
      ate: "2026-10-23",
      vendas: [],
      intervaloDeVendas: null,
    });
    expect(r.valor.every((d) => d.faturamento_centavos === null)).toBe(true);
    expect(r.n_registros).toBe(0);
    expect(r.menor_confianca).toBeNull();
  });

  it("mês: do dia 1 até a data", () => {
    const r = calcularSerieDeFaturamento({
      tipo: "mes",
      ate: "2026-10-05",
      vendas: [venda("2026-10-01", 10), venda("2026-10-05", 50)],
      intervaloDeVendas: { primeira: "2026-09-01", ultima: "2026-10-05" },
    });
    expect(r.valor.map((d) => d.data)).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
    ]);
    expect(r.valor.map((d) => d.faturamento_centavos)).toEqual([10, 0, 0, 0, 50]);
  });

  it("período coberto: as barras somam o faturamento do resumo do período", () => {
    const vendas = Array.from({ length: 23 }, (_, i) =>
      venda(`2026-10-${String(i + 1).padStart(2, "0")}`, 1_000 + i * 37),
    );
    const intervaloDeVendas = { primeira: "2026-09-01", ultima: "2026-10-23" };
    const serie = calcularSerieDeFaturamento({ tipo: "mes", ate: "2026-10-23", vendas, intervaloDeVendas });
    const resumo = calcularResumoDePeriodo({
      tipo: "mes",
      ate: "2026-10-23",
      vendas,
      intervaloDeVendas,
      movimentos: [],
      intervaloDeMovimentos: null,
    });
    if ("ausente" in resumo) throw new Error("resumo ausente");
    const soma = serie.valor.reduce((s, d) => s + (d.faturamento_centavos ?? 0), 0);
    expect(soma).toBe(resumo.valor.faturamento_centavos);
  });
});
