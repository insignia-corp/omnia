import { calcularAtencao, PARAMETROS_ATENCAO, type EntradaAtencao } from "./atencao";
import type { ProdutoParaMetrica, UltimaVendaDoProduto } from "./dados-de-metricas";
import type { MargemDoProduto } from "./margem-por-produto";
import { dadoAusente, type ResultadoMetrica } from "./resultado-metrica";
import type { VariacaoDeCusto } from "./variacao-de-custo";

const DIA = "2026-10-23";

const produto = (id: string): ProdutoParaMetrica => ({
  id,
  nome: `Produto ${id}`,
  margemMetaBps: null,
  origem: "dono",
  confianca: 1,
});
const produtos = ["a", "b", "c", "d", "e"].map(produto);

const variacao = (id: string, bps: number, compraAtualData: string): VariacaoDeCusto => ({
  produto_id: id,
  nome: `Produto ${id}`,
  fornecedor_id: "f",
  custo_anterior_centavos: 1000,
  custo_atual_centavos: 1000 + bps / 10,
  compra_anterior_data: "2026-09-20",
  compra_atual_data: compraAtualData,
  compra_atual_id: `compra-${id}`,
  variacao_bps: bps,
  variacao_percentual: bps / 100,
  acima_do_limite: bps > 500,
  recente: true,
  menor_confianca: 0.85,
});

const variacoes = (lista: VariacaoDeCusto[]): ResultadoMetrica<VariacaoDeCusto[]> => ({
  valor: lista,
  periodo: { inicio: "2026-09-20", fim: DIA },
  n_registros: lista.length * 2,
  menor_confianca: 0.85,
  origens: ["foto_nota"],
});

const margem = (id: string, margemBps: number, metaBps = 2500): ResultadoMetrica<MargemDoProduto> => ({
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
    preco_para_meta_centavos: null,
  },
  periodo: { inicio: "2026-09-24", fim: DIA },
  n_registros: 30,
  menor_confianca: 1,
  origens: ["planilha"],
});

const ultimaVenda = (id: string, data: string): UltimaVendaDoProduto => ({
  produtoId: id,
  data,
  registros: 1,
  menorConfianca: 1,
  origens: ["planilha"],
});

const entrada = (extra: Partial<EntradaAtencao> = {}): EntradaAtencao => ({
  data: DIA,
  produtos,
  variacoesDeCusto: variacoes([]),
  margens: [],
  ultimasVendas: [],
  ...extra,
});

describe("calcularAtencao", () => {
  it("põe custo que subiu, depois margem abaixo da meta, depois sem venda, até 3 e um por produto", () => {
    const r = calcularAtencao(
      entrada({
        variacoesDeCusto: variacoes([variacao("a", 1200, "2026-10-22")]),
        // "a" também está abaixo da meta, mas já entrou pelo custo.
        margens: [margem("a", 1000), margem("b", 2000), margem("c", 2600), dadoAusente("sem_custo", "x")],
        ultimasVendas: [ultimaVenda("d", "2026-10-01"), ultimaVenda("e", "2026-10-05")],
      }),
    );
    expect(r.valor).toEqual([
      {
        produto_id: "a",
        produto: "Produto a",
        motivo: "custo_subiu",
        custo_anterior_centavos: 1000,
        custo_atual_centavos: 1120,
        variacao_percentual: 12,
        data_compra: "2026-10-22",
      },
      {
        produto_id: "b",
        produto: "Produto b",
        motivo: "margem_abaixo_da_meta",
        margem_percentual: 20,
        meta_percentual: 25,
      },
      {
        produto_id: "d",
        produto: "Produto d",
        motivo: "sem_venda",
        dias_sem_venda: 22,
        ultima_venda: "2026-10-01",
      },
    ]);
    expect(r.periodo).toEqual({ inicio: "2026-09-20", fim: DIA });
    expect(r.menor_confianca).toBe(0.85);
    expect(r.origens).toEqual(["dono", "foto_nota", "planilha"]);
  });

  it("custo que subiu só conta acima do limite e com a compra nos 7 dias até a data", () => {
    const r = calcularAtencao(
      entrada({
        variacoesDeCusto: variacoes([
          variacao("a", 500, "2026-10-22"), // no limite, não passa
          variacao("b", 900, "2026-10-16"), // compra fora da janela de 7 dias (17 a 23)
          variacao("c", 900, "2026-10-17"),
          variacao("d", 900, "2026-10-24"), // depois da data
        ]),
      }),
    );
    expect(r.valor.map((p) => p.produto_id)).toEqual(["c"]);
  });

  it("usa o limite de reajuste do comerciante", () => {
    const r = calcularAtencao(entrada({ variacoesDeCusto: variacoes([variacao("c", 900, "2026-10-20")]) }), {
      ...PARAMETROS_ATENCAO,
      limiteReajusteBps: 1000,
    });
    expect(r.valor).toEqual([]);
  });

  it("margem abaixo da meta vem da menor para a maior", () => {
    const r = calcularAtencao(entrada({ margens: [margem("a", 2400), margem("b", 800), margem("c", 1500)] }));
    expect(r.valor.map((p) => p.produto_id)).toEqual(["b", "c", "a"]);
  });

  it("sem venda exige 14 dias ou mais e vem do mais parado para o menos", () => {
    const r = calcularAtencao(
      entrada({
        ultimasVendas: [
          ultimaVenda("a", "2026-10-10"), // 13 dias
          ultimaVenda("b", "2026-10-09"), // 14 dias
          ultimaVenda("c", "2026-09-01"),
          ultimaVenda("x", "2026-01-01"), // produto de fora da lista
        ],
      }),
    );
    expect(r.valor).toEqual([
      {
        produto_id: "c",
        produto: "Produto c",
        motivo: "sem_venda",
        dias_sem_venda: 52,
        ultima_venda: "2026-09-01",
      },
      {
        produto_id: "b",
        produto: "Produto b",
        motivo: "sem_venda",
        dias_sem_venda: 14,
        ultima_venda: "2026-10-09",
      },
    ]);
  });

  it("sem nada a apontar, a lista vem vazia com o período no dia", () => {
    const r = calcularAtencao(entrada());
    expect(r.valor).toEqual([]);
    expect(r.periodo).toEqual({ inicio: DIA, fim: DIA });
    expect(r.n_registros).toBe(0);
  });
});
