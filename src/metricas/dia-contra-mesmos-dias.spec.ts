import type { VendasDoDia } from "./dados-de-metricas";
import {
  calcularDiaContraMesmosDias,
  diaDaSemana,
  type EntradaDiaContraMesmosDias,
} from "./dia-contra-mesmos-dias";
import { ehDadoAusente } from "./resultado-metrica";

// Sexta-feira; as 3 sextas anteriores são 16, 9 e 2 de outubro.
const DIA = "2026-10-23";

const vendasDoDia = (data: string, faturamentoCentavos: number, cupons: number): VendasDoDia => ({
  data,
  cupons,
  faturamentoCentavos,
  registros: cupons,
  menorConfianca: 1,
  origens: ["planilha"],
});

const entrada = (extra: Partial<EntradaDiaContraMesmosDias> = {}): EntradaDiaContraMesmosDias => ({
  data: DIA,
  vendas: [
    vendasDoDia(DIA, 132_000, 60),
    vendasDoDia("2026-10-16", 120_000, 50),
    vendasDoDia("2026-10-09", 100_000, 50),
    vendasDoDia("2026-10-02", 110_000, 50),
    // Dia de outra semana não entra na média.
    vendasDoDia("2026-10-22", 999_999, 1),
  ],
  intervaloDeVendas: { primeira: "2026-09-01", ultima: DIA },
  ...extra,
});

function calcular(extra: Partial<EntradaDiaContraMesmosDias> = {}) {
  const r = calcularDiaContraMesmosDias(entrada(extra));
  if (ehDadoAusente(r)) throw new Error(`Esperava o resultado, veio dado ausente: ${r.codigo}`);
  return r;
}

describe("calcularDiaContraMesmosDias", () => {
  it("compara a sexta com a média das 3 sextas anteriores", () => {
    const r = calcular();
    expect(r.valor).toEqual({
      data: DIA,
      dia_da_semana: "sexta",
      dia: { faturamento_centavos: 132_000, vendas: 60, ticket_medio_centavos: 2200 },
      mesmos_dias_anteriores: {
        semanas: 3,
        datas: ["2026-10-16", "2026-10-09", "2026-10-02"],
        media_faturamento_centavos: 110_000,
        media_vendas: 50,
        media_ticket_medio_centavos: 2200,
      },
      // 132.000 contra 110.000: +20%. Ticket 2.200 contra 330.000 / 150 = 2.200: 0%.
      variacao_faturamento_bps: 2000,
      variacao_faturamento_percentual: 20,
      variacao_ticket_bps: 0,
      variacao_ticket_percentual: 0,
    });
    expect(r.periodo).toEqual({ inicio: "2026-10-02", fim: DIA });
    expect(r.n_registros).toBe(210);
    expect(r.menor_confianca).toBe(1);
    expect(r.origens).toEqual(["planilha"]);
  });

  it("usa a média exata nas variações e arredonda só o que é exibido", () => {
    const r = calcular({
      vendas: [
        vendasDoDia(DIA, 100_000, 40),
        vendasDoDia("2026-10-16", 100_000, 41),
        vendasDoDia("2026-10-09", 100_000, 41),
        vendasDoDia("2026-10-02", 100_001, 41),
      ],
    });
    // Média 300.001 / 3 = 100.000,33; ticket médio ponderado 300.001 / 123 = 2.439,03.
    expect(r.valor.mesmos_dias_anteriores.media_faturamento_centavos).toBe(100_000);
    expect(r.valor.mesmos_dias_anteriores.media_vendas).toBe(41);
    expect(r.valor.mesmos_dias_anteriores.media_ticket_medio_centavos).toBe(2439);
    expect(r.valor.dia.ticket_medio_centavos).toBe(2500);
    // (300.000 - 300.001) / 300.001 em bps arredonda para 0; o ticket sobe 2,50%.
    expect(r.valor.variacao_faturamento_bps).toBe(0);
    expect(r.valor.variacao_ticket_bps).toBe(250);
    expect(r.valor.variacao_ticket_percentual).toBe(2.5);
  });

  it("queda vem com sinal negativo", () => {
    const r = calcular({
      vendas: [
        vendasDoDia(DIA, 90_000, 50),
        vendasDoDia("2026-10-16", 100_000, 40),
        vendasDoDia("2026-10-09", 100_000, 40),
        vendasDoDia("2026-10-02", 100_000, 40),
      ],
    });
    expect(r.valor.variacao_faturamento_percentual).toBe(-10);
    // Ticket 1.800 contra 2.500: -28%.
    expect(r.valor.variacao_ticket_percentual).toBe(-28);
  });

  it("dia sem vendas importadas é dado ausente, não zero", () => {
    const r = calcularDiaContraMesmosDias(
      entrada({ intervaloDeVendas: { primeira: "2026-09-01", ultima: "2026-10-22" } }),
    );
    expect(ehDadoAusente(r) && r.codigo).toBe("dia_sem_dados");
  });

  it("dia importado sem nenhuma venda é dado ausente", () => {
    const r = calcularDiaContraMesmosDias(
      entrada({ vendas: entrada().vendas.filter((v) => v.data !== DIA) }),
    );
    expect(ehDadoAusente(r) && r.codigo).toBe("sem_vendas_no_dia");
  });

  it("falta de um dos mesmos dias anteriores é dado ausente", () => {
    const semUmaSexta = calcularDiaContraMesmosDias(
      entrada({ intervaloDeVendas: { primeira: "2026-10-05", ultima: DIA } }),
    );
    expect(ehDadoAusente(semUmaSexta) && semUmaSexta.codigo).toBe("historico_insuficiente");
    const sextaSemVenda = calcularDiaContraMesmosDias(
      entrada({ vendas: entrada().vendas.filter((v) => v.data !== "2026-10-09") }),
    );
    expect(ehDadoAusente(sextaSemVenda) && sextaSemVenda.codigo).toBe("historico_insuficiente");
  });

  it("diaDaSemana nomeia o dia em português", () => {
    expect(diaDaSemana("2026-10-23")).toBe("sexta");
    expect(diaDaSemana("2026-10-24")).toBe("sábado");
    expect(diaDaSemana("2026-10-25")).toBe("domingo");
  });
});
