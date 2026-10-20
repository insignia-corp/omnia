import {
  assinaturaDosCabecalhos,
  normalizarCabecalho,
  sugerirMapeamento,
  validarMapeamento,
} from "./mapeamento";

const CABECALHOS_PDV = [
  "Data",
  "Hora",
  "Cupom",
  "Código de barras",
  "Produto",
  "Qtd",
  "Preço unit. (R$)",
  "Total (R$)",
];

describe("normalizarCabecalho", () => {
  it("tira acento, caixa, pontuação e a unidade entre parênteses", () => {
    expect(normalizarCabecalho("Preço unit. (R$)")).toBe("preco unit");
    expect(normalizarCabecalho("  Código de Barras ")).toBe("codigo de barras");
    expect(normalizarCabecalho("Nº Cupom")).toBe("n cupom");
  });
});

describe("sugerirMapeamento", () => {
  it("reconhece o cabeçalho do PDV da Etapa 1 por inteiro", () => {
    expect(sugerirMapeamento(CABECALHOS_PDV)).toEqual({
      mapeamento: {
        data: "Data",
        hora: "Hora",
        cupom: "Cupom",
        codigo_barras: "Código de barras",
        produto: "Produto",
        quantidade: "Qtd",
        preco_unitario: "Preço unit. (R$)",
        total: "Total (R$)",
      },
      faltando: [],
    });
  });

  it("reconhece nomes de outro sistema", () => {
    const r = sugerirMapeamento(["DT VENDA", "DESCRIÇÃO", "QTDE", "VLR UNIT", "VLR TOTAL", "EAN"]);
    expect(r.mapeamento).toEqual({
      data: "DT VENDA",
      produto: "DESCRIÇÃO",
      quantidade: "QTDE",
      preco_unitario: "VLR UNIT",
      total: "VLR TOTAL",
      codigo_barras: "EAN",
    });
    expect(r.faltando).toEqual([]);
  });

  it("aponta o que falta em vez de chutar", () => {
    const r = sugerirMapeamento(["Data", "Produto", "Total"]);
    expect(r.faltando).toEqual(["quantidade", "preco_unitario"]);
    expect(r.mapeamento.total).toBe("Total");
  });

  it("não usa a mesma coluna para dois campos", () => {
    const r = sugerirMapeamento(["Data", "Produto", "Qtd", "Preço"]);
    expect(r.mapeamento.preco_unitario).toBe("Preço");
    expect(Object.values(r.mapeamento)).toHaveLength(new Set(Object.values(r.mapeamento)).size);
  });
});

describe("assinaturaDosCabecalhos", () => {
  it("não depende da ordem das colunas nem de caixa ou acento", () => {
    expect(assinaturaDosCabecalhos(["Produto", "Data", "Qtd"])).toBe(
      assinaturaDosCabecalhos(["QTD", "data", "PRODUTO"]),
    );
    expect(assinaturaDosCabecalhos(["Produto", "Data"])).not.toBe(
      assinaturaDosCabecalhos(["Produto", "Data", "Qtd"]),
    );
  });
});

describe("validarMapeamento", () => {
  const ok = sugerirMapeamento(CABECALHOS_PDV).mapeamento;

  it("aceita o mapeamento sugerido", () => {
    expect(validarMapeamento(ok, CABECALHOS_PDV)).toEqual([]);
  });

  it("recusa coluna que não existe, coluna repetida e campo obrigatório ausente", () => {
    const erros = validarMapeamento(
      { data: "Data", produto: "Data", quantidade: "Quantidade?", preco_unitario: "Total (R$)" },
      CABECALHOS_PDV,
    );
    expect([...new Set(erros.map((e) => e.campo))].sort()).toEqual(["produto", "quantidade"]);
    expect(erros.some((e) => e.campo === "quantidade" && /não existe/.test(e.mensagem))).toBe(true);
    expect(erros.some((e) => e.campo === "produto" && /já está ligada/.test(e.mensagem))).toBe(true);
  });

  it("exige os quatro campos obrigatórios", () => {
    const erros = validarMapeamento({ data: "Data" }, CABECALHOS_PDV);
    expect(erros.map((e) => e.campo)).toEqual(["produto", "quantidade", "preco_unitario"]);
  });
});
