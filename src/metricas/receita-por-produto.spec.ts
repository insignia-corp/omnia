import type { ProdutoParaMetrica, VendaDoProdutoNoDia } from "./dados-de-metricas";
import {
  calcularReceitaPorProduto,
  type EntradaReceitaPorProduto,
  type ParametrosReceita,
} from "./receita-por-produto";
import { ehDadoAusente } from "./resultado-metrica";

const REF = "2026-10-19";
const produtos: ProdutoParaMetrica[] = [
  { id: "p-arroz", nome: "Arroz", margemMetaBps: null, origem: "dono", confianca: 1 },
  { id: "p-cafe", nome: "Café", margemMetaBps: null, origem: "dono", confianca: 1 },
  { id: "p-feijao", nome: "Feijão", margemMetaBps: null, origem: "dono", confianca: 1 },
];
const venda = (
  produtoId: string,
  data: string,
  receitaCentavos: number,
  extra: Partial<VendaDoProdutoNoDia> = {},
) => ({
  data,
  produtoId,
  quantidade: 1,
  receitaCentavos,
  registros: 1,
  menorConfianca: 1,
  origens: ["planilha" as const],
  ...extra,
});
const entrada = (
  vendas: VendaDoProdutoNoDia[],
  extra: Partial<EntradaReceitaPorProduto> = {},
): EntradaReceitaPorProduto => ({
  produtos,
  vendas,
  intervaloDeVendas: { primeira: "2026-08-20", ultima: REF },
  dataReferencia: REF,
  ...extra,
});
const calcular = (e: EntradaReceitaPorProduto, p?: ParametrosReceita) => {
  const r = calcularReceitaPorProduto(e, p);
  if (ehDadoAusente(r)) throw new Error("dado ausente inesperado");
  return r;
};

describe("calcularReceitaPorProduto", () => {
  it("soma em centavos inteiros os 7 dias até a data de referência e ordena do maior para o menor", () => {
    const r = calcular(
      entrada([
        venda("p-arroz", "2026-10-19", 1999),
        venda("p-arroz", "2026-10-13", 1),
        venda("p-cafe", "2026-10-15", 2500),
        venda("p-feijao", "2026-10-14", 100),
      ]),
    );
    expect(r.valor.periodo).toEqual({ inicio: "2026-10-13", fim: REF });
    expect(r.valor.maior_receita.map((p) => [p.nome, p.receita_centavos])).toEqual([
      ["Café", 2500],
      ["Arroz", 2000],
      ["Feijão", 100],
    ]);
  });

  it("deixa de fora o dia antes da janela e o dia depois da data", () => {
    const r = calcular(entrada([venda("p-arroz", "2026-10-12", 9999), venda("p-arroz", "2026-10-20", 9999)]));
    expect(r.valor.por_produto.every((p) => p.receita_centavos === 0)).toBe(true);
    expect(r.valor.maior_receita).toEqual([]);
    expect(r.n_registros).toBe(0);
  });

  it("produto sem venda na janela fica com zero e fora do ranking", () => {
    const r = calcular(entrada([venda("p-arroz", "2026-10-19", 500)]));
    expect(r.valor.por_produto.map((p) => [p.nome, p.receita_centavos])).toEqual([
      ["Arroz", 500],
      ["Café", 0],
      ["Feijão", 0],
    ]);
    expect(r.valor.maior_receita.map((p) => p.nome)).toEqual(["Arroz"]);
  });

  it("desempata pelo nome em ordem alfabética do português, com o cadastro em ordem inversa", () => {
    const cadastro: ProdutoParaMetrica[] = [
      { id: "p-3", nome: "Zebra", margemMetaBps: null, origem: "dono", confianca: 1 },
      { id: "p-2", nome: "Água", margemMetaBps: null, origem: "dono", confianca: 1 },
      { id: "p-1", nome: "Arroz", margemMetaBps: null, origem: "dono", confianca: 1 },
    ];
    const r = calcular(
      entrada(
        [venda("p-3", "2026-10-19", 300), venda("p-2", "2026-10-19", 300), venda("p-1", "2026-10-19", 300)],
        { produtos: cadastro },
      ),
    );
    // "Água" vem depois de "Arroz" no português (a acentuação não manda para depois do Z).
    expect(r.valor.maior_receita.map((p) => p.nome)).toEqual(["Água", "Arroz", "Zebra"]);
    expect(r.valor.por_produto.map((p) => p.nome)).toEqual(["Água", "Arroz", "Zebra"]);
  });

  it("nomes iguais desempatam pelo id", () => {
    const cadastro: ProdutoParaMetrica[] = [
      { id: "p-b", nome: "Arroz", margemMetaBps: null, origem: "dono", confianca: 1 },
      { id: "p-a", nome: "Arroz", margemMetaBps: null, origem: "dono", confianca: 1 },
    ];
    const r = calcular(
      entrada([venda("p-b", "2026-10-19", 300), venda("p-a", "2026-10-19", 300)], { produtos: cadastro }),
    );
    expect(r.valor.maior_receita.map((p) => p.produto_id)).toEqual(["p-a", "p-b"]);
  });

  it("limita o ranking ao topN", () => {
    const r = calcular(
      entrada([
        venda("p-arroz", "2026-10-19", 3),
        venda("p-cafe", "2026-10-19", 2),
        venda("p-feijao", "2026-10-19", 1),
      ]),
      { topN: 2 },
    );
    expect(r.valor.maior_receita.map((p) => p.nome)).toEqual(["Arroz", "Café"]);
    expect(r.valor.por_produto).toHaveLength(3);
  });

  it("ignora venda de produto fora do cadastro", () => {
    const r = calcular(entrada([venda("p-outro", "2026-10-19", 7777), venda("p-arroz", "2026-10-19", 10)]));
    expect(r.valor.maior_receita.map((p) => p.nome)).toEqual(["Arroz"]);
    expect(r.n_registros).toBe(1);
  });

  it("devolve período, número de registros, menor confiança e origens das vendas usadas", () => {
    const r = calcular(
      entrada([
        venda("p-arroz", "2026-10-19", 10, { registros: 3, menorConfianca: 0.9, origens: ["planilha"] }),
        venda("p-cafe", "2026-10-18", 20, { registros: 2, menorConfianca: 0.7, origens: ["banco"] }),
        venda("p-cafe", "2026-10-01", 20, { menorConfianca: 0.1 }),
      ]),
    );
    expect(r.periodo).toEqual({ inicio: "2026-10-13", fim: REF });
    expect(r.n_registros).toBe(5);
    expect(r.menor_confianca).toBe(0.7);
    expect(r.origens).toEqual(["banco", "dono", "planilha"]);
  });

  it("a origem e a confiança do cadastro entram na procedência, sem contar como registro", () => {
    const cadastro = [
      { id: "p-arroz", nome: "Arroz", margemMetaBps: null, origem: "foto_nota" as const, confianca: 0.6 },
      { id: "p-cafe", nome: "Café", margemMetaBps: null, origem: "nfe" as const, confianca: 1 },
    ];
    const r = calcular(entrada([venda("p-cafe", "2026-10-19", 20)], { produtos: cadastro }));
    expect(r.menor_confianca).toBe(0.6);
    expect(r.origens).toEqual(["foto_nota", "nfe", "planilha"]);
    expect(r.n_registros).toBe(1);
  });

  it.each([
    ["sem nenhuma venda importada", null],
    ["vendas que começam depois do início da janela", { primeira: "2026-10-14", ultima: REF }],
    ["vendas que acabam antes da data", { primeira: "2026-08-20", ultima: "2026-10-18" }],
  ])("é dado ausente %s, não receita zero", (_nome, intervaloDeVendas) => {
    const r = calcularReceitaPorProduto(entrada([venda("p-arroz", "2026-10-19", 10)], { intervaloDeVendas }));
    expect(ehDadoAusente(r)).toBe(true);
    if (ehDadoAusente(r)) {
      expect(r.codigo).toBe("historico_insuficiente");
      expect(r.pergunta_sugerida).toBeDefined();
    }
  });

  it("cobertura exata da janela basta", () => {
    const r = calcularReceitaPorProduto(
      entrada([], { intervaloDeVendas: { primeira: "2026-10-13", ultima: REF } }),
    );
    expect(ehDadoAusente(r)).toBe(false);
  });
});
