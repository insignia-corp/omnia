import { calcularEspacoParaSubirPreco } from "./espaco-para-subir-preco";
import type { Giro, GiroDoProduto } from "./giro";
import type { MargemDoProduto } from "./margem-por-produto";
import { dadoAusente, type DadoAusente, type ResultadoMetrica } from "./resultado-metrica";

const PERIODO = { inicio: "2026-09-15", fim: "2026-10-19" };

const giroDoProduto = (id: string, extra: Partial<GiroDoProduto> = {}): GiroDoProduto => ({
  produto_id: id,
  nome: `Produto ${id}`,
  unidades_7_dias: 100,
  unidades_28_dias_anteriores: 200,
  media_semanal_28_dias: 50,
  alta_bps: 10_000,
  alta_percentual: 100,
  elegivel_para_alta: true,
  ...extra,
});

const giro = (porProduto: GiroDoProduto[], giroAlto: string[], extra: Partial<ResultadoMetrica<Giro>> = {}) =>
  ({
    valor: {
      periodos: {
        ultimos_7_dias: { inicio: "2026-10-13", fim: "2026-10-19" },
        anteriores_28_dias: { inicio: "2026-09-15", fim: "2026-10-12" },
      },
      por_produto: porProduto,
      maior_alta: [],
      maior_volume: [],
      giro_alto: giroAlto,
    },
    periodo: PERIODO,
    n_registros: 500,
    menor_confianca: 1,
    origens: ["planilha"],
    ...extra,
  }) satisfies ResultadoMetrica<Giro>;

const margem = (
  id: string,
  margemBps: number,
  metaBps = 2500,
  extra: Partial<ResultadoMetrica<MargemDoProduto>> = {},
): { produto_id: string; resultado: ResultadoMetrica<MargemDoProduto> } => ({
  produto_id: id,
  resultado: {
    valor: {
      produto_id: id,
      nome: `Produto ${id}`,
      preco_medio_venda_centavos: 500,
      unidades_vendidas: 80,
      custo_compra_mais_recente_centavos: 400,
      compra_data: "2026-10-10",
      fornecedor_id: "f",
      margem_bps: margemBps,
      margem_percentual: margemBps / 100,
      meta_bps: metaBps,
      meta_percentual: metaBps / 100,
      abaixo_da_meta: margemBps < metaBps,
    },
    periodo: { inicio: "2026-09-20", fim: "2026-10-19" },
    n_registros: 30,
    menor_confianca: 1,
    origens: ["foto_nota", "planilha"],
    ...extra,
  },
});

describe("calcularEspacoParaSubirPreco", () => {
  it("lista o produto de giro alto com margem abaixo da meta", () => {
    // Cerveja: margem de 21,28% contra meta de 25%, entre as maiores altas.
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("cerveja")], ["cerveja"]),
      margens: [margem("cerveja", 2128)],
    });
    expect(r.valor).toEqual([
      {
        produto_id: "cerveja",
        nome: "Produto cerveja",
        margem_bps: 2128,
        margem_percentual: 21.28,
        meta_bps: 2500,
        meta_percentual: 25,
        preco_medio_venda_centavos: 500,
        custo_compra_mais_recente_centavos: 400,
        unidades_7_dias: 100,
        alta_bps: 10_000,
        alta_percentual: 100,
      },
    ]);
  });

  it("giro alto com margem acima da meta não tem espaço", () => {
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("a")], ["a"]),
      margens: [margem("a", 3500)],
    });
    expect(r.valor).toEqual([]);
  });

  it("margem abaixo da meta sem giro alto também não", () => {
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("a")], []),
      margens: [margem("a", 1000)],
    });
    expect(r.valor).toEqual([]);
  });

  it("margem igual à meta não está abaixo dela", () => {
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("a")], ["a"]),
      margens: [margem("a", 2500)],
    });
    expect(r.valor).toEqual([]);
  });

  it("giro alto sem margem calculável fica de fora, sem erro", () => {
    const semCusto: DadoAusente = dadoAusente("sem_custo", "Sem nota de compra.");
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("a"), giroDoProduto("b")], ["a", "b"]),
      margens: [{ produto_id: "a", resultado: semCusto }, margem("b", 2000)],
    });
    expect(r.valor.map((p) => p.produto_id)).toEqual(["b"]);
  });

  it("produto de giro alto que não está na lista de margens fica de fora", () => {
    const r = calcularEspacoParaSubirPreco({ giro: giro([giroDoProduto("a")], ["a"]), margens: [] });
    expect(r.valor).toEqual([]);
  });

  it("a meta do produto vale: abaixo da meta dele, não da do comerciante", () => {
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("a")], ["a"]),
      margens: [margem("a", 1800, 2000)],
    });
    expect(r.valor[0]).toMatchObject({ margem_bps: 1800, meta_bps: 2000, meta_percentual: 20 });
  });

  it("ordena por nome", () => {
    const r = calcularEspacoParaSubirPreco({
      giro: giro([giroDoProduto("leite"), giroDoProduto("cerveja")], ["leite", "cerveja"]),
      margens: [margem("leite", 2067), margem("cerveja", 2128)],
    });
    expect(r.valor.map((p) => p.produto_id)).toEqual(["cerveja", "leite"]);
  });

  describe("procedência dos dados", () => {
    it("usa o período do giro e soma o giro com a margem de cada produto listado", () => {
      const r = calcularEspacoParaSubirPreco({
        giro: giro([giroDoProduto("a"), giroDoProduto("b"), giroDoProduto("c")], ["a", "b", "c"], {
          n_registros: 500,
          menor_confianca: 0.9,
        }),
        margens: [
          margem("a", 2000, 2500, { n_registros: 30, menor_confianca: 0.7, origens: ["nfe", "planilha"] }),
          margem("b", 2000, 2500, { n_registros: 20 }),
          margem("c", 4000), // acima da meta: não entra nem na procedência
        ],
      });
      expect(r.periodo).toEqual(PERIODO);
      expect(r.n_registros).toBe(500 + 30 + 20);
      expect(r.menor_confianca).toBe(0.7);
      expect(r.origens).toEqual(["foto_nota", "nfe", "planilha"]);
    });
  });
});
