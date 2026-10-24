import type { ProdutoParaMetrica, VendaDoProdutoNoDia } from "./dados-de-metricas";
import {
  calcularMaisVendidos,
  calcularPiores,
  type EntradaMovimentoDeProdutos,
} from "./movimento-de-produtos";
import { ehDadoAusente } from "./resultado-metrica";

const DIA = "2026-10-23";
// Semana: 17 a 23/10. Semana anterior: 10 a 16/10.
const NA_SEMANA = "2026-10-20";
const NA_ANTERIOR = "2026-10-12";

const produto = (id: string, nome: string): ProdutoParaMetrica => ({
  id,
  nome,
  margemMetaBps: null,
  origem: "dono",
  confianca: 0.9,
});

const produtos = [
  produto("p-arroz", "Arroz 5kg"),
  produto("p-cafe", "Café 500g"),
  produto("p-leite", "Leite 1L"),
  produto("p-oleo", "Óleo 900ml"),
  produto("p-sal", "Sal 1kg"),
];

const venda = (produtoId: string, data: string, quantidade: number): VendaDoProdutoNoDia => ({
  data,
  produtoId,
  quantidade,
  receitaCentavos: quantidade * 1000,
  registros: 1,
  menorConfianca: 1,
  origens: ["planilha"],
});

const entrada = (vendas: VendaDoProdutoNoDia[], extra: Partial<EntradaMovimentoDeProdutos> = {}) => ({
  produtos,
  vendas,
  intervaloDeVendas: { primeira: "2026-09-01", ultima: DIA },
  data: DIA,
  ...extra,
});

describe("calcularMaisVendidos", () => {
  it("traz os 3 de mais unidades nos 7 dias até a data, com desempate por nome", () => {
    const r = calcularMaisVendidos(
      entrada([
        venda("p-leite", NA_SEMANA, 30),
        venda("p-leite", DIA, 10),
        venda("p-arroz", NA_SEMANA, 25),
        venda("p-cafe", "2026-10-17", 25),
        venda("p-oleo", NA_SEMANA, 5),
        // Fora da janela: não conta.
        venda("p-sal", NA_ANTERIOR, 100),
        venda("p-desconhecido", NA_SEMANA, 500),
      ]),
    );
    if (ehDadoAusente(r)) throw new Error(r.codigo);
    expect(r.valor).toEqual([
      { produto_id: "p-leite", produto: "Leite 1L", unidades_7_dias: 40 },
      { produto_id: "p-arroz", produto: "Arroz 5kg", unidades_7_dias: 25 },
      { produto_id: "p-cafe", produto: "Café 500g", unidades_7_dias: 25 },
    ]);
    expect(r.periodo).toEqual({ inicio: "2026-10-17", fim: DIA });
    expect(r.n_registros).toBe(5);
    expect(r.menor_confianca).toBe(0.9);
    expect(r.origens).toEqual(["dono", "planilha"]);
  });

  it("vendas que não cobrem os 7 dias viram dado ausente", () => {
    const r = calcularMaisVendidos(
      entrada([venda("p-leite", DIA, 3)], { intervaloDeVendas: { primeira: "2026-10-19", ultima: DIA } }),
    );
    expect(ehDadoAusente(r)).toBe(true);
  });
});

describe("calcularPiores", () => {
  it("traz as maiores quedas em unidades, só com volume mínimo na semana anterior", () => {
    const r = calcularPiores(
      entrada([
        // Leite: 50 para 20, queda de 30 unidades (-60%).
        venda("p-leite", NA_ANTERIOR, 50),
        venda("p-leite", NA_SEMANA, 20),
        // Arroz: 100 para 80, queda de 20 (-20%).
        venda("p-arroz", NA_ANTERIOR, 100),
        venda("p-arroz", NA_SEMANA, 80),
        // Café: 20 para 0, queda de 20 (-100%): empata com o arroz e vem antes pela maior queda percentual.
        venda("p-cafe", NA_ANTERIOR, 20),
        // Óleo: 9 para 0, abaixo do mínimo de 10 na semana anterior.
        venda("p-oleo", NA_ANTERIOR, 9),
        // Sal: subiu, não é pior.
        venda("p-sal", NA_ANTERIOR, 10),
        venda("p-sal", NA_SEMANA, 12),
      ]),
    );
    if (ehDadoAusente(r)) throw new Error(r.codigo);
    expect(r.valor).toEqual([
      {
        produto_id: "p-leite",
        produto: "Leite 1L",
        unidades_7_dias: 20,
        unidades_7_dias_anteriores: 50,
        variacao_bps: -6000,
        variacao_percentual: -60,
      },
      {
        produto_id: "p-cafe",
        produto: "Café 500g",
        unidades_7_dias: 0,
        unidades_7_dias_anteriores: 20,
        variacao_bps: -10_000,
        variacao_percentual: -100,
      },
      {
        produto_id: "p-arroz",
        produto: "Arroz 5kg",
        unidades_7_dias: 80,
        unidades_7_dias_anteriores: 100,
        variacao_bps: -2000,
        variacao_percentual: -20,
      },
    ]);
    expect(r.periodo).toEqual({ inicio: "2026-10-10", fim: DIA });
  });

  it("sem queda, a lista vem vazia", () => {
    const r = calcularPiores(entrada([venda("p-leite", NA_ANTERIOR, 10), venda("p-leite", NA_SEMANA, 10)]));
    expect(!ehDadoAusente(r) && r.valor).toEqual([]);
  });

  it("vendas que não cobrem as 2 semanas viram dado ausente", () => {
    const r = calcularPiores(
      entrada([venda("p-leite", NA_SEMANA, 3)], {
        intervaloDeVendas: { primeira: "2026-10-12", ultima: DIA },
      }),
    );
    expect(ehDadoAusente(r)).toBe(true);
  });
});
