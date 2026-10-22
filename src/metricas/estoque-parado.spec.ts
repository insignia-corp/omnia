import { somarDias } from "../lib/datas/datas";
import type { CustoDeCompra, ProdutoParaMetrica, UltimaVendaDoProduto } from "./dados-de-metricas";
import {
  calcularEstoqueParado,
  PARAMETROS_ESTOQUE_PARADO,
  type EntradaEstoqueParado,
} from "./estoque-parado";

const REF = "2026-10-19";

const produto = (id: string, nome = id): ProdutoParaMetrica => ({
  id,
  nome,
  margemMetaBps: null,
  origem: "dono",
  confianca: 1,
});

const ultimaVenda = (
  produtoId: string,
  diasAtras: number,
  extra: Partial<UltimaVendaDoProduto> = {},
): UltimaVendaDoProduto => ({
  produtoId,
  data: somarDias(REF, -diasAtras),
  registros: 4,
  menorConfianca: 1,
  origens: ["planilha"],
  ...extra,
});

const compra = (
  produtoId: string,
  data = "2026-08-24",
  extra: Partial<CustoDeCompra> = {},
): CustoDeCompra => ({
  produtoId,
  fornecedorId: "f",
  compraId: `compra-${produtoId}-${data}`,
  itemDeCompraId: `item-${produtoId}-${data}`,
  data,
  custoUnitarioCentavos: 100,
  confianca: 1,
  origem: "foto_nota",
  criadoEm: new Date(`${data}T12:00:00Z`),
  ...extra,
});

const calcular = (extra: Partial<EntradaEstoqueParado>) =>
  calcularEstoqueParado({ produtos: [], custos: [], ultimasVendas: [], dataReferencia: REF, ...extra });

const ids = (r: ReturnType<typeof calcular>) => r.valor.map((p) => p.produto_id);

describe("calcularEstoqueParado", () => {
  it("conta os dias desde a última venda e marca o que passou de 30", () => {
    // Vinagre: última venda em 8/9, 41 dias antes. Achocolatado: 25 dias.
    const r = calcular({
      produtos: [produto("vinagre"), produto("achocolatado")],
      custos: [compra("vinagre"), compra("achocolatado")],
      ultimasVendas: [ultimaVenda("vinagre", 41), ultimaVenda("achocolatado", 25)],
    });
    expect(r.valor).toEqual([
      {
        produto_id: "vinagre",
        nome: "vinagre",
        ultima_venda: "2026-09-08",
        dias_sem_venda: 41,
        parado: true,
      },
      {
        produto_id: "achocolatado",
        nome: "achocolatado",
        ultima_venda: "2026-09-24",
        dias_sem_venda: 25,
        parado: false,
      },
    ]);
  });

  describe("limite de 30 dias", () => {
    it("30 dias ainda não é parado; 31 é", () => {
      const r = calcular({
        produtos: [produto("a"), produto("b")],
        custos: [compra("a"), compra("b")],
        ultimasVendas: [ultimaVenda("a", 30), ultimaVenda("b", 31)],
      });
      expect(r.valor.map((p) => [p.produto_id, p.parado])).toEqual([
        ["b", true],
        ["a", false],
      ]);
    });

    it("aceita outro limite pelos parâmetros", () => {
      const r = calcularEstoqueParado(
        {
          produtos: [produto("a")],
          custos: [compra("a")],
          ultimasVendas: [ultimaVenda("a", 20)],
          dataReferencia: REF,
        },
        { ...PARAMETROS_ESTOQUE_PARADO, limiteDias: 15 },
      );
      expect(r.valor[0]?.parado).toBe(true);
    });
  });

  describe("quem entra", () => {
    it("produto que nunca foi comprado fica de fora, mesmo sem vender há meses", () => {
      const r = calcular({
        produtos: [produto("sem-compra"), produto("com-compra")],
        custos: [compra("com-compra")],
        ultimasVendas: [ultimaVenda("sem-compra", 90), ultimaVenda("com-compra", 10)],
      });
      expect(ids(r)).toEqual(["com-compra"]);
    });

    it("compra posterior à data de referência não conta como compra", () => {
      const r = calcular({
        produtos: [produto("a")],
        custos: [compra("a", "2026-10-25")],
        ultimasVendas: [ultimaVenda("a", 40)],
      });
      expect(r.valor).toEqual([]);
    });

    it("produto comprado que nunca vendeu na base fica de fora: sem última venda não há como medir", () => {
      const r = calcular({ produtos: [produto("a")], custos: [compra("a")], ultimasVendas: [] });
      expect(r.valor).toEqual([]);
    });

    it("produto que vendeu hoje não está parado", () => {
      const r = calcular({
        produtos: [produto("a")],
        custos: [compra("a")],
        ultimasVendas: [ultimaVenda("a", 0)],
      });
      expect(r.valor).toEqual([]);
    });

    it("venda depois da data de referência é ignorada", () => {
      const r = calcular({
        produtos: [produto("a")],
        custos: [compra("a")],
        ultimasVendas: [{ ...ultimaVenda("a", 0), data: "2026-10-25" }],
      });
      expect(r.valor).toEqual([]);
    });
  });

  describe("quantos aparecem", () => {
    const produtos = ["a", "b", "c", "d", "e", "f", "g"].map((id) => produto(id));
    const custos = produtos.map((p) => compra(p.id));

    it("sem parados, os 5 mais próximos do limite", () => {
      const r = calcular({
        produtos,
        custos,
        ultimasVendas: [1, 2, 3, 4, 5, 6, 7].map((dias, i) => ultimaVenda(produtos[i]?.id ?? "", dias)),
      });
      expect(ids(r)).toEqual(["g", "f", "e", "d", "c"]);
    });

    it("todo parado entra, mesmo passando de 5", () => {
      const r = calcular({
        produtos,
        custos,
        ultimasVendas: [31, 32, 33, 34, 35, 36, 5].map((dias, i) => ultimaVenda(produtos[i]?.id ?? "", dias)),
      });
      expect(ids(r)).toEqual(["f", "e", "d", "c", "b", "a"]);
      expect(r.valor.every((p) => p.parado)).toBe(true);
    });

    it("o top N vem dos parâmetros", () => {
      const r = calcularEstoqueParado(
        {
          produtos,
          custos,
          ultimasVendas: [1, 2, 3, 4, 5, 6, 7].map((dias, i) => ultimaVenda(produtos[i]?.id ?? "", dias)),
          dataReferencia: REF,
        },
        { ...PARAMETROS_ESTOQUE_PARADO, topN: 2 },
      );
      expect(ids(r)).toEqual(["g", "f"]);
    });

    it("empate de dias desempata pelo nome em ordem alfabética do português", () => {
      const r = calcular({
        produtos: [produto("1", "Ovos"), produto("2", "Água"), produto("3", "Zebra")],
        custos: [compra("1"), compra("2"), compra("3")],
        ultimasVendas: [ultimaVenda("1", 40), ultimaVenda("2", 40), ultimaVenda("3", 40)],
      });
      expect(ids(r)).toEqual(["2", "1", "3"]);
    });
  });

  describe("procedência dos dados", () => {
    it("período da venda mais antiga até a data", () => {
      const r = calcular({
        produtos: [produto("a"), produto("b")],
        custos: [compra("a"), compra("b")],
        ultimasVendas: [ultimaVenda("a", 41), ultimaVenda("b", 5)],
      });
      expect(r.periodo).toEqual({ inicio: "2026-09-08", fim: REF });
    });

    it("sem nenhum parado, o período é só a data", () => {
      expect(calcular({}).periodo).toEqual({ inicio: REF, fim: REF });
    });

    it("a confiança e a origem do cadastro do produto listado entram; a de produto fora da lista não", () => {
      const r = calcular({
        produtos: [
          { ...produto("a"), origem: "foto_nota", confianca: 0.4 },
          { ...produto("b"), origem: "nfe", confianca: 0.2 },
        ],
        custos: [compra("a")],
        ultimasVendas: [ultimaVenda("a", 41), ultimaVenda("b", 5)],
      });
      // "b" não tem compra, então não aparece no resultado nem pesa nele.
      expect(r.valor.map((p) => p.produto_id)).toEqual(["a"]);
      expect(r.menor_confianca).toBe(0.4);
      expect(r.origens).toEqual(["foto_nota", "planilha"]);
    });

    it("conta as linhas das últimas vendas e as compras, herda a menor confiança e junta as origens", () => {
      const r = calcular({
        produtos: [produto("a"), produto("b")],
        custos: [compra("a", "2026-08-24", { confianca: 0.5, origem: "nfe" }), compra("b")],
        ultimasVendas: [
          ultimaVenda("a", 41, { registros: 9 }),
          ultimaVenda("b", 10, { menorConfianca: 0.8 }),
        ],
      });
      expect(r.n_registros).toBe(9 + 1 + 4 + 1);
      expect(r.menor_confianca).toBe(0.5);
      expect(r.origens).toEqual(["dono", "foto_nota", "nfe", "planilha"]);
    });
  });
});
