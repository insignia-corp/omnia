import { readFileSync } from "node:fs";
import { dadoAusente } from "../../metricas/resultado-metrica";
import type { ResumoDiario } from "../../metricas/resumo-diario";
import type { ResultadoMetrica } from "../../metricas/resultado-metrica";
import { formatarBps, modeloResumoDiario, rotuloDoDia } from "./modelo-resumo-diario";
import { corpoDoModelo, MODELOS, montarTemplate } from "./modelos";

const resumo = (variacao: number | null = -3023): ResultadoMetrica<ResumoDiario> => ({
  valor: {
    data: "2026-10-19",
    faturamento_centavos: 122151,
    gastos_centavos: 101534,
    saldo_do_dia_centavos: 20617,
    saldo_da_conta: { saldo_centavos: 1 },
    cupons: 78,
    ticket_medio_centavos: 1566,
    comparacao_faturamento: {
      dia_anterior: dadoAusente("x", "x"),
      mesmo_dia_semana_anterior: dadoAusente("x", "x"),
      media_7_dias_anteriores: {
        data: null,
        base_centavos: 175072,
        variacao_bps: variacao,
        variacao_percentual: variacao === null ? null : variacao / 100,
      },
    },
  },
  periodo: { inicio: "2026-10-12", fim: "2026-10-19" },
  n_registros: 1,
  menor_confianca: 1,
  origens: ["planilha"],
});

describe("modeloResumoDiario", () => {
  it("preenche o resumo_diario com os números do resumo do dia do gabarito", () => {
    const t = modeloResumoDiario(resumo(), "Mercadinho Vila Nova", 7)!;
    expect(corpoDoModelo(t)).toBe(
      "Bom dia! Em segunda, 19/10, o *Mercadinho Vila Nova* faturou *R$ 1.221,51* em 78 vendas, 30,23% abaixo da média dos 7 dias anteriores.\n\nSeparei 3 avisos que merecem sua atenção hoje.",
    );
    expect(t.components.filter((c) => c.type === "button")).toHaveLength(MODELOS.resumo_diario.botoes.length);
  });

  it("igual à média não diz acima nem abaixo", () => {
    expect(corpoDoModelo(modeloResumoDiario(resumo(0), "X", 1)!)).toContain(
      "em 78 vendas, igual ao valor da média dos 7 dias anteriores.",
    );
  });

  it("acima da média diz acima", () => {
    expect(corpoDoModelo(modeloResumoDiario(resumo(1250), "X", 1)!)).toContain("12,50% acima da média");
  });

  it("sem resumo ou sem a média dos 7 dias, não monta modelo (nunca parâmetro inventado)", () => {
    expect(modeloResumoDiario(dadoAusente("dia_sem_dados", "sem vendas"), "X", 1)).toBeNull();
    expect(modeloResumoDiario(resumo(null), "X", 1)).toBeNull();
  });
});

describe("rotuloDoDia e formatarBps", () => {
  it("dia da semana e data curta", () => {
    expect(rotuloDoDia("2026-10-19")).toBe("segunda, 19/10");
    expect(rotuloDoDia("2026-10-18")).toBe("domingo, 18/10");
  });

  it("pontos-base em percentual, só com inteiros", () => {
    expect(formatarBps(3023)).toBe("30,23%");
    expect(formatarBps(2500)).toBe("25%");
    expect(formatarBps(5)).toBe("0,05%");
    expect(formatarBps(-1205)).toBe("-12,05%");
  });
});

describe("modelos", () => {
  it("recusa parâmetro ou botão faltando", () => {
    expect(() => montarTemplate("resumo_diario", ["a"], ["x", "y", "z"])).toThrow(/6 parâmetros/);
    expect(() => montarTemplate("resumo_diario", ["1", "2", "3", "4", "5", "6"], ["x"])).toThrow(/3 botões/);
  });

  it("a cópia do front (web/whatsapp/modelos.js) tem o mesmo texto e os mesmos botões", () => {
    const front = readFileSync("web/whatsapp/modelos.js", "utf8");
    for (const [nome, modelo] of Object.entries(MODELOS)) {
      expect({ nome, corpo: front.includes(JSON.stringify(modelo.corpo)) }).toEqual({ nome, corpo: true });
      expect(front).toContain(JSON.stringify(modelo.cabecalho));
      expect(front).toContain(`botoes: ${JSON.stringify(modelo.botoes).replace(/,/g, ", ")}`);
    }
  });
});
