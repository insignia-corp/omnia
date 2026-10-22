import { readFileSync } from "node:fs";
import type { MovimentoDoDia, VendasDoDia } from "./dados-de-metricas";
import { ehDadoAusente, type DadoAusente } from "./resultado-metrica";
import {
  calcularResumoDePeriodo,
  periodosDoResumo,
  type ComparacaoDePeriodo,
  type EntradaResumoDePeriodo,
} from "./resumo-de-periodo";

interface DiaDaSerie {
  data: string;
  faturamento_centavos: number;
  cupons: number;
  gastos_total_centavos: number;
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  serie_diaria: DiaDaSerie[];
};
const serie = gabarito.serie_diaria;
const janela = { primeira: serie[0]!.data, ultima: serie.at(-1)!.data };

const vendas: VendasDoDia[] = serie.map((d) => ({
  data: d.data,
  cupons: d.cupons,
  faturamentoCentavos: d.faturamento_centavos,
  registros: d.cupons,
  menorConfianca: 1,
  origens: ["planilha"],
}));
const movimentos: MovimentoDoDia[] = serie.map((d) => ({
  contaId: "conta-1",
  data: d.data,
  tipo: "saida",
  categoria: null,
  totalCentavos: d.gastos_total_centavos,
  registros: 1,
  menorConfianca: 1,
  origens: ["banco"],
}));

const entrada = (tipo: "semana" | "mes", ate: string, extra: Partial<EntradaResumoDePeriodo> = {}) => ({
  tipo,
  ate,
  vendas,
  intervaloDeVendas: janela,
  movimentos,
  intervaloDeMovimentos: janela,
  ...extra,
});

/** Soma de uma coluna da série do gabarito entre duas datas, inclusive. */
const somaDaSerie = (inicio: string, fim: string, coluna: keyof Omit<DiaDaSerie, "data">) =>
  serie.filter((d) => d.data >= inicio && d.data <= fim).reduce((s, d) => s + d[coluna], 0);

function semAusente<T>(r: T | DadoAusente): T {
  if (ehDadoAusente(r)) throw new Error(`Dado ausente inesperado: ${r.motivo}`);
  return r;
}

describe("periodosDoResumo", () => {
  it("semana: os 7 dias até a data contra os 7 anteriores", () => {
    expect(periodosDoResumo("semana", "2026-10-19")).toEqual({
      atual: { inicio: "2026-10-13", fim: "2026-10-19" },
      anterior: { inicio: "2026-10-06", fim: "2026-10-12" },
    });
  });

  it("mês: do dia 1 até a data contra os mesmos dias do mês anterior", () => {
    expect(periodosDoResumo("mes", "2026-10-19")).toEqual({
      atual: { inicio: "2026-10-01", fim: "2026-10-19" },
      anterior: { inicio: "2026-09-01", fim: "2026-09-19" },
    });
  });

  it("mês: o fim do anterior para no último dia dele e janeiro compara com dezembro", () => {
    expect(periodosDoResumo("mes", "2026-03-31").anterior).toEqual({
      inicio: "2026-02-01",
      fim: "2026-02-28",
    });
    expect(periodosDoResumo("mes", "2028-03-30").anterior).toEqual({
      inicio: "2028-02-01",
      fim: "2028-02-29",
    });
    expect(periodosDoResumo("mes", "2027-01-15").anterior).toEqual({
      inicio: "2026-12-01",
      fim: "2026-12-15",
    });
  });
});

describe("calcularResumoDePeriodo contra a série diária do gabarito", () => {
  it.each([
    ["semana", "2026-10-13", "2026-10-06", "2026-10-12"],
    ["mes", "2026-10-01", "2026-09-01", "2026-09-19"],
  ] as const)("%s até 2026-10-19", (tipo, inicio, inicioAnterior, fimAnterior) => {
    const r = semAusente(calcularResumoDePeriodo(entrada(tipo, "2026-10-19")));
    const fat = somaDaSerie(inicio, "2026-10-19", "faturamento_centavos");
    const cupons = somaDaSerie(inicio, "2026-10-19", "cupons");
    const gastos = somaDaSerie(inicio, "2026-10-19", "gastos_total_centavos");
    const base = somaDaSerie(inicioAnterior, fimAnterior, "faturamento_centavos");

    expect(r.valor).toMatchObject({
      tipo,
      inicio,
      fim: "2026-10-19",
      faturamento_centavos: fat,
      cupons,
      ticket_medio_centavos: Math.round(fat / cupons),
      gastos_centavos: gastos,
      saldo_do_periodo_centavos: fat - gastos,
    });
    const comparacao = semAusente<ComparacaoDePeriodo>(r.valor.comparacao_faturamento);
    expect(comparacao).toMatchObject({ inicio: inicioAnterior, fim: fimAnterior, base_centavos: base });
    expect(comparacao.variacao_bps).toBe(Math.round(((fat - base) * 10_000) / base));
    expect(r.periodo).toEqual({ inicio: inicioAnterior, fim: "2026-10-19" });
    expect(r.menor_confianca).toBe(1);
    expect(r.origens).toEqual(["banco", "planilha"]);
  });

  it("bate com os números que o roteiro do pitch mostra", () => {
    const semana = semAusente(calcularResumoDePeriodo(entrada("semana", "2026-10-19"))).valor;
    expect([semana.faturamento_centavos, semana.cupons, semana.gastos_centavos]).toEqual([
      1170942, 447, 290059,
    ]);
    const mes = semAusente(calcularResumoDePeriodo(entrada("mes", "2026-10-19"))).valor;
    expect([mes.faturamento_centavos, mes.cupons, mes.gastos_centavos]).toEqual([3165305, 1159, 1243621]);
    expect((mes.comparacao_faturamento as ComparacaoDePeriodo).base_centavos).toBe(3029588);
  });

  it("período com dia fora das vendas importadas é dado ausente, não total menor", () => {
    const r = calcularResumoDePeriodo(entrada("semana", "2026-10-20"));
    expect(ehDadoAusente(r) && r.codigo).toBe("periodo_sem_dados");
  });

  it("sem histórico para o período anterior, só a comparação fica ausente", () => {
    const r = semAusente(calcularResumoDePeriodo(entrada("mes", "2026-09-10")));
    expect(r.valor.faturamento_centavos).toBe(
      somaDaSerie("2026-09-01", "2026-09-10", "faturamento_centavos"),
    );
    const comparacao = r.valor.comparacao_faturamento;
    expect(ehDadoAusente(comparacao) && comparacao.codigo).toBe("base_sem_dados");
  });

  it("extrato que não cobre o período inteiro deixa gastos e saldo ausentes, nunca zero", () => {
    const r = semAusente(
      calcularResumoDePeriodo(
        entrada("semana", "2026-10-19", {
          intervaloDeMovimentos: { primeira: janela.primeira, ultima: "2026-10-18" },
        }),
      ),
    );
    expect(ehDadoAusente(r.valor.gastos_centavos)).toBe(true);
    expect(ehDadoAusente(r.valor.saldo_do_periodo_centavos)).toBe(true);
    expect(r.origens).toEqual(["planilha"]);
  });

  it("período sem cupom tem ticket médio nulo", () => {
    const zerado = vendas.map((v) => ({ ...v, cupons: 0, faturamentoCentavos: 0 }));
    const r = semAusente(calcularResumoDePeriodo(entrada("semana", "2026-10-19", { vendas: zerado })));
    expect(r.valor.ticket_medio_centavos).toBeNull();
    expect((r.valor.comparacao_faturamento as ComparacaoDePeriodo).variacao_bps).toBeNull();
  });
});
