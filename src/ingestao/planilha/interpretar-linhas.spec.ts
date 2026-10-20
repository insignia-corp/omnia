import { readFileSync } from "node:fs";
import { interpretarData, interpretarLinhas, montarCatalogo } from "./interpretar-linhas";
import { lerCsv, lerXlsx } from "./leitor-planilha";
import { sugerirMapeamento } from "./mapeamento";

const catalogoFixture = JSON.parse(readFileSync("fixtures/mercadinho/catalogo.json", "utf8")) as Array<{
  id: string;
  nome: string;
  codigo_barras: string;
}>;
const catalogo = montarCatalogo(
  catalogoFixture.map((p) => ({ id: p.id, nome: p.nome, codigoBarras: p.codigo_barras })),
);
const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  resumo_diario: { referencia: { data: string; faturamento_centavos: number; cupons: number } };
};

const CAB = ["Data", "Cupom", "Produto", "Código de barras", "Qtd", "Preço unit.", "Total"];
const mapa = sugerirMapeamento(CAB).mapeamento;
const interpretar = (linhas: string[][]) =>
  interpretarLinhas({ cabecalhos: CAB, linhas, mapeamento: mapa }, catalogo);
const BARRAS = catalogoFixture[0]!.codigo_barras;
const ID = catalogoFixture[0]!.id;
const boa = ["20/08/2026", "1", "qualquer", BARRAS, "2", "2,79", "5,58"];

describe("interpretarData", () => {
  it("aceita dd/mm/aaaa, dd-mm-aaaa e AAAA-MM-DD", () => {
    expect(interpretarData("20/08/2026")).toBe("2026-08-20");
    expect(interpretarData("5-1-2026")).toBe("2026-01-05");
    expect(interpretarData("2026-08-20")).toBe("2026-08-20");
    expect(interpretarData("2026-08-20T10:00:00.000Z")).toBe("2026-08-20");
  });

  it("recusa o que não é data real", () => {
    for (const t of ["", "31/02/2026", "2026-13-01", "ontem", "20/08/26"])
      expect(interpretarData(t)).toBeNull();
  });
});

describe("interpretarLinhas", () => {
  it("interpreta uma linha boa em centavos inteiros, ligando o produto pelo código de barras", () => {
    const r = interpretar([boa]);
    expect(r.rejeitadas).toEqual([]);
    expect(r.itens).toEqual([
      {
        linha: 2,
        data: "2026-08-20",
        hora: null,
        cupom: "1",
        produtoId: ID,
        quantidade: 2,
        precoUnitarioCentavos: 279,
        totalCentavos: 558,
      },
    ]);
  });

  it("sem código de barras, liga pelo nome normalizado do cadastro", () => {
    const nome = catalogoFixture[0]!.nome.toUpperCase();
    expect(interpretar([["20/08/2026", "1", nome, "", "1", "2,79", ""]]).itens[0]?.produtoId).toBe(ID);
  });

  it("aceita quantidade fracionária com vírgula", () => {
    expect(interpretar([["20/08/2026", "1", "x", BARRAS, "0,250", "10,00", "2,50"]]).itens[0]).toMatchObject({
      quantidade: 0.25,
      totalCentavos: 250,
    });
  });

  it("rejeita quantidade com mais casas do que o banco guarda (numeric 14,3)", () => {
    const r = interpretar([
      ["20/08/2026", "1", "x", BARRAS, "1,2345", "1,00", ""],
      ["20/08/2026", "2", "x", BARRAS, "0,0004", "1,00", ""],
      ["20/08/2026", "3", "x", BARRAS, "100000000000", "1,00", ""],
      ["20/08/2026", "4", "x", BARRAS, "1,234", "1,00", ""],
    ]);
    expect(r.itens.map((i) => i.quantidade)).toEqual([1.234]);
    expect(r.rejeitadas.map((x) => x.motivo.split(":")[0])).toEqual(Array(3).fill("Quantidade inválida"));
  });

  it("nome que dois produtos compartilham não escolhe um: rejeita e pede o código de barras", () => {
    const duplicado = montarCatalogo([
      { id: "a", nome: "Água Mineral 500 ml", codigoBarras: "111" },
      { id: "b", nome: "AGUA MINERAL 500 ML", codigoBarras: "222" },
      { id: "c", nome: "Água Mineral 500 ml", codigoBarras: null },
    ]);
    const r = interpretarLinhas(
      {
        cabecalhos: CAB,
        linhas: [
          ["20/08/2026", "1", "agua mineral 500 ml", "", "1", "2,00", ""],
          ["20/08/2026", "2", "agua mineral 500 ml", "222", "1", "2,00", ""],
        ],
        mapeamento: mapa,
      },
      duplicado,
    );
    expect(r.itens.map((i) => i.produtoId)).toEqual(["b"]);
    expect(r.rejeitadas).toHaveLength(1);
    expect(r.rejeitadas[0]?.motivo).toContain("Mais de um produto");
  });

  it("rejeita cada linha ruim com o motivo e segue com as boas", () => {
    const r = interpretar([
      boa,
      ["31/02/2026", "2", "x", BARRAS, "1", "1,00", "1,00"],
      ["20/08/2026", "3", "x", BARRAS, "zero", "1,00", "1,00"],
      ["20/08/2026", "4", "x", BARRAS, "1", "abc", "1,00"],
      ["20/08/2026", "5", "x", BARRAS, "1", "-1,00", ""],
      ["20/08/2026", "6", "produto que não existe", "", "1", "1,00", "1,00"],
      ["20/08/2026", "7", "x", BARRAS, "2", "2,79", "9,99"],
      ["20/08/2026", "8", "x", BARRAS, "2", "2,79", "lixo"],
    ]);
    expect(r.itens).toHaveLength(1);
    expect(r.rejeitadas.map((x) => x.linha)).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(r.rejeitadas.map((x) => x.motivo.split(":")[0])).toEqual([
      "Data inválida",
      "Quantidade inválida",
      "Preço inválido",
      "Preço negativo",
      "Produto não encontrado no cadastro",
      "Total não confere",
      "Total inválido",
    ]);
  });

  it("sem coluna de cupom, cada linha vira uma venda própria", () => {
    const sem = ["Data", "Produto", "Qtd", "Preço unit."];
    const r = interpretarLinhas(
      {
        cabecalhos: sem,
        linhas: [["20/08/2026", catalogoFixture[0]!.nome, "1", "2,79"]],
        mapeamento: sugerirMapeamento(sem).mapeamento,
      },
      catalogo,
    );
    expect(r.itens[0]?.cupom).toBe("L2");
  });

  it("cupom sintético leva a origem: planilhas diferentes não colidem, o mesmo arquivo repete", () => {
    const sem = ["Data", "Produto", "Qtd", "Preço unit."];
    const entrada = (origem: string) => ({
      cabecalhos: sem,
      linhas: [["20/08/2026", catalogoFixture[0]!.nome, "1", "2,79"]],
      mapeamento: sugerirMapeamento(sem).mapeamento,
      origem,
    });
    const cupom = (origem: string) => interpretarLinhas(entrada(origem), catalogo).itens[0]?.cupom;
    expect(cupom("aaa")).toBe("aaa-L2");
    expect(cupom("aaa")).toBe(cupom("aaa"));
    expect(cupom("bbb")).not.toBe(cupom("aaa"));
  });
});

describe("planilhas da Etapa 1 contra o gabarito", () => {
  const referencia = gabarito.resumo_diario.referencia;

  const conferir = (cabecalhos: string[], linhas: string[][]) => {
    const { mapeamento, faltando } = sugerirMapeamento(cabecalhos);
    expect(faltando).toEqual([]);
    const r = interpretarLinhas({ cabecalhos, linhas, mapeamento }, catalogo);
    expect(r.rejeitadas).toEqual([]);
    expect(r.itens).toHaveLength(11_365);
    const doDia = r.itens.filter((i) => i.data === referencia.data);
    expect(doDia.reduce((s, i) => s + i.totalCentavos, 0)).toBe(referencia.faturamento_centavos);
    expect(new Set(doDia.map((i) => i.cupom)).size).toBe(referencia.cupons);
    expect(new Set(r.itens.map((i) => `${i.data}/${i.cupom}`)).size).toBe(3623);
  };

  it("o CSV importa sem rejeição e bate com o faturamento e os cupons do dia de referência", () => {
    const p = lerCsv(readFileSync("fixtures/mercadinho/vendas.csv"));
    conferir(p.cabecalhos, p.linhas);
  });

  it("o XLSX dá exatamente o mesmo resultado", async () => {
    const p = await lerXlsx(readFileSync("fixtures/mercadinho/vendas.xlsx"));
    conferir(p.cabecalhos, p.linhas);
  });
});
