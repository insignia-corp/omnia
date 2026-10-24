import type { ProdutoEmAtencao } from "./atencao";
import { montarBriefingDiario, type EntradaBriefingDiario } from "./briefing-diario";
import type { DiaContraMesmosDias } from "./dia-contra-mesmos-dias";
import type { ProdutoEmQueda, ProdutoMaisVendido } from "./movimento-de-produtos";
import { dadoAusente, type ResultadoMetrica } from "./resultado-metrica";

const DIA = "2026-10-23";

const comparacao: ResultadoMetrica<DiaContraMesmosDias> = {
  valor: {
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
    variacao_faturamento_bps: 2000,
    variacao_faturamento_percentual: 20,
    variacao_ticket_bps: 0,
    variacao_ticket_percentual: 0,
  },
  periodo: { inicio: "2026-10-02", fim: DIA },
  n_registros: 210,
  menor_confianca: 1,
  origens: ["planilha"],
};

const maisVendidos: ResultadoMetrica<ProdutoMaisVendido[]> = {
  valor: [{ produto_id: "p", produto: "Leite", unidades_7_dias: 40 }],
  periodo: { inicio: "2026-10-17", fim: DIA },
  n_registros: 7,
  menor_confianca: 0.9,
  origens: ["dono", "planilha"],
};

const piores: ResultadoMetrica<ProdutoEmQueda[]> = {
  valor: [
    {
      produto_id: "q",
      produto: "Arroz",
      unidades_7_dias: 8,
      unidades_7_dias_anteriores: 10,
      variacao_bps: -2000,
      variacao_percentual: -20,
    },
  ],
  periodo: { inicio: "2026-10-10", fim: DIA },
  n_registros: 14,
  menor_confianca: 1,
  origens: ["planilha"],
};

const atencao: ResultadoMetrica<ProdutoEmAtencao[]> = {
  valor: [
    { produto_id: "r", produto: "Café", motivo: "sem_venda", dias_sem_venda: 20, ultima_venda: "2026-10-03" },
  ],
  periodo: { inicio: "2026-10-03", fim: DIA },
  n_registros: 1,
  menor_confianca: 0.8,
  origens: ["foto_nota"],
};

const entrada = (extra: Partial<EntradaBriefingDiario> = {}): EntradaBriefingDiario => ({
  data: DIA,
  diaContraMesmosDias: comparacao,
  maisVendidos,
  piores,
  atencao,
  ...extra,
});

describe("montarBriefingDiario", () => {
  it("monta a saída do contrato e junta a procedência dos blocos", () => {
    expect(montarBriefingDiario(entrada())).toEqual({
      data: DIA,
      dia_da_semana: "sexta",
      dia: comparacao.valor.dia,
      mesmos_dias_anteriores: comparacao.valor.mesmos_dias_anteriores,
      variacao_faturamento_percentual: 20,
      variacao_ticket_percentual: 0,
      dias_da_janela_produtos: 7,
      mais_vendidos: maisVendidos.valor,
      piores: [
        {
          produto_id: "q",
          produto: "Arroz",
          unidades_7_dias: 8,
          unidades_7_dias_anteriores: 10,
          variacao_percentual: -20,
        },
      ],
      atencao: atencao.valor,
      periodo: { inicio: "2026-10-02", fim: DIA },
      n_registros: 232,
      menor_confianca: 0.8,
      origens: ["dono", "foto_nota", "planilha"],
    });
  });

  it("bloco sem dado vem como dado ausente, nunca zero, e não entra na procedência", () => {
    const semDia = dadoAusente("dia_sem_dados", `Não há vendas importadas para ${DIA}.`);
    const semSemanas = dadoAusente("historico_insuficiente", "sem cobertura");
    const r = montarBriefingDiario(
      entrada({ diaContraMesmosDias: semDia, maisVendidos: semSemanas, piores: semSemanas }),
    );
    expect(r.dia).toEqual(semDia);
    expect(r.mesmos_dias_anteriores).toEqual(semDia);
    expect(r.variacao_faturamento_percentual).toBeNull();
    expect(r.variacao_ticket_percentual).toBeNull();
    expect(r.mais_vendidos).toEqual(semSemanas);
    expect(r.piores).toEqual(semSemanas);
    expect(r.periodo).toEqual({ inicio: "2026-10-03", fim: DIA });
    expect(r.n_registros).toBe(1);
  });
});
