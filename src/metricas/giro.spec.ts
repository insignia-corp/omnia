import type { ProdutoParaMetrica, VendaDoProdutoNoDia } from "./dados-de-metricas";
import { calcularGiro, type EntradaGiro } from "./giro";
import { ehDadoAusente } from "./resultado-metrica";

const REF = "2026-10-19";
/** Vendas importadas de 15/09 a 19/10: as duas janelas inteiras. */
const COBERTURA = { primeira: "2026-09-15", ultima: REF };

const produto = (id: string, nome = id): ProdutoParaMetrica => ({
  id,
  nome,
  margemMetaBps: null,
  origem: "dono",
  confianca: 1,
});

const venda = (
  produtoId: string,
  data: string,
  quantidade: number,
  extra: Partial<VendaDoProdutoNoDia> = {},
): VendaDoProdutoNoDia => ({
  data,
  produtoId,
  quantidade,
  receitaCentavos: quantidade * 100,
  registros: 1,
  menorConfianca: 1,
  origens: ["planilha"],
  ...extra,
});

const calcularOuAusente = (entrada: Partial<EntradaGiro>) =>
  calcularGiro({ produtos: [], vendas: [], intervaloDeVendas: COBERTURA, dataReferencia: REF, ...entrada });

const calcular = (entrada: Partial<EntradaGiro>) => {
  const r = calcularOuAusente(entrada);
  if (ehDadoAusente(r)) throw new Error(`Esperava giro, veio dado ausente: ${r.codigo}`);
  return r;
};

const doProduto = (r: ReturnType<typeof calcular>, id: string) => {
  const g = r.valor.por_produto.find((p) => p.produto_id === id);
  if (!g) throw new Error(`produto ${id} fora do giro`);
  return g;
};

describe("calcularGiro", () => {
  describe("cobertura das vendas importadas", () => {
    it.each([
      ["sem nenhuma venda importada", null],
      ["só 14 dias de vendas, de 06/10 a 19/10", { primeira: "2026-10-06", ultima: REF }],
      ["a janela de 28 dias começa um dia antes da primeira venda", { primeira: "2026-09-16", ultima: REF }],
      [
        "a última venda importada é anterior à data de referência",
        { primeira: "2026-09-15", ultima: "2026-10-18" },
      ],
    ])("%s: dado ausente, não volume zero", (_caso, intervaloDeVendas) => {
      const r = calcularOuAusente({
        produtos: [produto("a")],
        vendas: [venda("a", "2026-10-15", 40)],
        intervaloDeVendas,
      });
      expect(r).toMatchObject({ ausente: true, codigo: "historico_insuficiente" });
    });

    it("com as duas janelas cobertas, dia sem venda dentro delas vale zero", () => {
      const r = calcular({
        produtos: [produto("a")],
        vendas: [venda("a", "2026-10-15", 40)],
        intervaloDeVendas: { primeira: "2026-09-15", ultima: REF },
      });
      expect(doProduto(r, "a").unidades_7_dias).toBe(40);
    });
  });

  describe("janelas", () => {
    it("os últimos 7 dias vão de 13/10 a 19/10 e os 28 anteriores de 15/09 a 12/10", () => {
      const r = calcular({ produtos: [produto("a")] });
      expect(r.valor.periodos).toEqual({
        ultimos_7_dias: { inicio: "2026-10-13", fim: "2026-10-19" },
        anteriores_28_dias: { inicio: "2026-09-15", fim: "2026-10-12" },
      });
      expect(r.periodo).toEqual({ inicio: "2026-09-15", fim: REF });
    });

    it("conta cada venda na janela certa, incluindo as pontas", () => {
      const r = calcular({
        produtos: [produto("a")],
        vendas: [
          venda("a", "2026-10-19", 1), // último dia
          venda("a", "2026-10-13", 2), // primeiro dia dos 7
          venda("a", "2026-10-12", 4), // último dia dos 28
          venda("a", "2026-09-15", 8), // primeiro dia dos 28
          venda("a", "2026-09-14", 16), // fora
          venda("a", "2026-10-20", 32), // depois da referência
        ],
      });
      expect(doProduto(r, "a")).toMatchObject({ unidades_7_dias: 3, unidades_28_dias_anteriores: 12 });
      expect(r.n_registros).toBe(4);
    });
  });

  describe("alta", () => {
    it("compara as 7 dias com a média semanal dos 28 anteriores", () => {
      // 56 unidades em 28 dias dão média de 14 por semana; 21 nos últimos 7 dias é +50%.
      const r = calcular({
        produtos: [produto("a")],
        vendas: [venda("a", "2026-09-20", 56), venda("a", "2026-10-15", 21)],
      });
      expect(doProduto(r, "a")).toEqual({
        produto_id: "a",
        nome: "a",
        unidades_7_dias: 21,
        unidades_28_dias_anteriores: 56,
        media_semanal_28_dias: 14,
        alta_bps: 5000,
        alta_percentual: 50,
        elegivel_para_alta: true,
      });
    });

    it("queda é alta negativa", () => {
      const r = calcular({
        produtos: [produto("a")],
        vendas: [venda("a", "2026-09-20", 56), venda("a", "2026-10-15", 7)],
      });
      expect(doProduto(r, "a")).toMatchObject({ alta_bps: -5000, alta_percentual: -50 });
    });

    it("sem venda nos 28 dias anteriores a alta não existe", () => {
      const r = calcular({ produtos: [produto("a")], vendas: [venda("a", "2026-10-15", 10)] });
      expect(doProduto(r, "a")).toMatchObject({
        unidades_28_dias_anteriores: 0,
        alta_bps: null,
        alta_percentual: null,
        elegivel_para_alta: false,
      });
    });

    it("produto sem nenhuma venda aparece zerado", () => {
      const r = calcular({ produtos: [produto("a")] });
      expect(doProduto(r, "a")).toMatchObject({
        unidades_7_dias: 0,
        unidades_28_dias_anteriores: 0,
        alta_bps: null,
      });
    });
  });

  describe("elegibilidade pela média semanal mínima de 14", () => {
    it("55 unidades em 28 dias (média 13,75) não são elegíveis; 56 (média 14) são", () => {
      const r = calcular({
        produtos: [produto("a"), produto("b")],
        vendas: [
          venda("a", "2026-09-20", 55),
          venda("a", "2026-10-15", 30),
          venda("b", "2026-09-20", 56),
          venda("b", "2026-10-15", 30),
        ],
      });
      expect(doProduto(r, "a")).toMatchObject({ media_semanal_28_dias: 13.75, elegivel_para_alta: false });
      expect(doProduto(r, "b")).toMatchObject({ media_semanal_28_dias: 14, elegivel_para_alta: true });
      expect(r.valor.maior_alta.map((g) => g.produto_id)).toEqual(["b"]);
    });

    it("quantidade fracionária não decide o limite por ruído de ponto flutuante", () => {
      // 140 vendas de 0,4 kg somam 56 kg; em ponto flutuante direto dão 55,99999999999987.
      const vendas = Array.from({ length: 140 }, () => venda("a", "2026-09-20", 0.4));
      expect(vendas.reduce((soma, v) => soma + v.quantidade, 0)).toBeLessThan(56);
      const r = calcular({ produtos: [produto("a")], vendas });
      expect(doProduto(r, "a")).toMatchObject({ unidades_28_dias_anteriores: 56, elegivel_para_alta: true });
    });
  });

  describe("rankings", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    // Cada produto vende 56 nos 28 dias anteriores (elegível) e `recentes` nos últimos 7.
    const recentes: Record<string, number> = { a: 14, b: 42, c: 28, d: 70, e: 21, f: 56, g: 35 };
    const vendas = ids.flatMap((id) => [
      venda(id, "2026-09-20", 56),
      venda(id, "2026-10-15", recentes[id] ?? 0),
    ]);
    const r = calcular({ produtos: ids.map((id) => produto(id)), vendas });

    it("maior alta: os 5 de maior variação, em ordem", () => {
      expect(r.valor.maior_alta.map((g) => g.produto_id)).toEqual(["d", "f", "b", "g", "c"]);
    });

    it("maior volume: os 5 que mais venderam nos últimos 7 dias, em ordem", () => {
      expect(r.valor.maior_volume.map((g) => g.produto_id)).toEqual(["d", "f", "b", "g", "c"]);
    });

    it("giro alto junta os dois rankings sem repetir", () => {
      expect(r.valor.giro_alto).toEqual(["b", "c", "d", "f", "g"]);
    });

    it("o top N vem dos parâmetros", () => {
      const dois = calcularGiro(
        { produtos: ids.map((id) => produto(id)), vendas, intervaloDeVendas: COBERTURA, dataReferencia: REF },
        {
          minimoMediaSemanal: 14,
          topN: 2,
        },
      );
      if (ehDadoAusente(dois)) throw new Error("Esperava giro, veio dado ausente");
      expect(dois.valor.maior_alta.map((g) => g.produto_id)).toEqual(["d", "f"]);
    });

    it("produto de pouco volume pode estar entre os de maior volume sem estar entre os de maior alta", () => {
      const poucos = calcular({
        produtos: [produto("a"), produto("b")],
        vendas: [
          venda("a", "2026-09-20", 8), // média 2: não elegível
          venda("a", "2026-10-15", 40),
          venda("b", "2026-09-20", 56),
          venda("b", "2026-10-15", 15),
        ],
      });
      expect(poucos.valor.maior_alta.map((g) => g.produto_id)).toEqual(["b"]);
      expect(poucos.valor.maior_volume.map((g) => g.produto_id)).toEqual(["a", "b"]);
    });

    it("maior volume deixa de fora quem não vendeu nada nos últimos 7 dias", () => {
      const sem = calcular({
        produtos: [produto("a"), produto("b")],
        vendas: [venda("a", "2026-10-15", 3)],
      });
      expect(sem.valor.maior_volume.map((g) => g.produto_id)).toEqual(["a"]);
    });
  });

  describe("desempate", () => {
    it("alta igual desempata pelo nome e depois pelo id", () => {
      const r = calcular({
        produtos: [produto("2", "Beta"), produto("1", "Beta"), produto("3", "Alfa")],
        vendas: ["1", "2", "3"].flatMap((id) => [venda(id, "2026-09-20", 56), venda(id, "2026-10-15", 28)]),
      });
      expect(r.valor.maior_alta.map((g) => g.produto_id)).toEqual(["3", "1", "2"]);
    });

    it("por_produto sai em ordem estável de nome", () => {
      const r = calcular({ produtos: [produto("2", "Beta"), produto("3", "Alfa"), produto("1", "Beta")] });
      expect(r.valor.por_produto.map((g) => g.produto_id)).toEqual(["3", "1", "2"]);
    });

    it("o nome com acento fica junto da letra, não depois do Z", () => {
      // 65 unidades nos dois: empate no volume, como a água e os ovos do gabarito.
      const r = calcular({
        produtos: [
          produto("ovos", "Ovos brancos dúzia"),
          produto("agua", "Água mineral 1,5L"),
          produto("z", "Zebra"),
        ],
        vendas: ["ovos", "agua", "z"].map((id) => venda(id, "2026-10-15", 65)),
      });
      expect(r.valor.maior_volume.map((g) => g.produto_id)).toEqual(["agua", "ovos", "z"]);
    });
  });

  describe("procedência dos dados", () => {
    it("soma as linhas de venda das duas janelas e herda a menor confiança", () => {
      const r = calcular({
        produtos: [produto("a")],
        vendas: [
          venda("a", "2026-10-15", 1, { registros: 3 }),
          venda("a", "2026-09-20", 1, { registros: 2, menorConfianca: 0.9 }),
          venda("a", "2026-08-01", 1, { menorConfianca: 0.1 }), // fora das janelas
        ],
      });
      expect(r.n_registros).toBe(5);
      expect(r.menor_confianca).toBe(0.9);
      expect(r.origens).toEqual(["dono", "planilha"]);
    });

    it("produto de catálogo sem venda informa a origem e a confiança do cadastro", () => {
      const r = calcular({
        produtos: [{ ...produto("a"), origem: "foto_nota", confianca: 0.6 }, produto("b")],
        vendas: [venda("b", "2026-10-15", 5)],
      });
      expect(doProduto(r, "a").unidades_7_dias).toBe(0);
      expect(r.menor_confianca).toBe(0.6);
      expect(r.origens).toEqual(["dono", "foto_nota", "planilha"]);
      expect(r.n_registros).toBe(1);
    });

    it("ignora venda de produto que não está na lista", () => {
      const r = calcular({ produtos: [produto("a")], vendas: [venda("fantasma", "2026-10-15", 5)] });
      expect(r.n_registros).toBe(0);
      expect(r.valor.por_produto).toHaveLength(1);
    });
  });
});
