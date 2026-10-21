import type { ExtracaoNota, ItemExtraido } from "../../ingestao/extracao/esquema-extracao";
import { classificarConfianca, compararNota, errosDaNota, normalizarTexto } from "./comparador";

const item = (descricao: string, extra: Partial<ItemExtraido> = {}): ItemExtraido => ({
  descricao,
  quantidade: 10,
  unidade: "UN",
  valor_unitario_centavos: 500,
  valor_total_centavos: 5000,
  confianca: 1,
  ...extra,
});

const nota = (extra: Partial<ExtracaoNota> = {}): ExtracaoNota => ({
  fornecedor: { nome: "Pão Quente Ltda", cnpj: "22786541000120" },
  data_emissao: "2026-09-30",
  itens: [
    item("ARROZ 5KG"),
    item("FEIJAO 1KG", { valor_unitario_centavos: 700, valor_total_centavos: 7000 }),
  ],
  total_centavos: 12000,
  confianca_documento: 1,
  ...extra,
});

describe("compararNota", () => {
  it("extração igual ao gabarito: todos os campos certos e nenhum erro", () => {
    const c = compararNota(nota(), nota());
    expect(c.campos).toEqual({ certos: 14, total: 14 });
    expect(c.somaItensCorreta).toBe(true);
    expect(c.cnpjObtidoValido).toBe(true);
    expect(errosDaNota(c)).toEqual([]);
    const conf = classificarConfianca(c);
    expect(conf.errosSilenciosos).toEqual([]);
    expect(conf.itensAbaixoDoLimite).toEqual([]);
  });

  it("ignora acento, caixa, espaços e máscara do CNPJ", () => {
    const obtido = nota({
      fornecedor: { nome: "PAO  QUENTE LTDA", cnpj: "22.786.541/0001-20" },
      itens: [item("arroz  5kg", { unidade: "un" }), nota().itens[1] as ItemExtraido],
    });
    expect(errosDaNota(compararNota(nota(), obtido))).toEqual([]);
    expect(normalizarTexto("  Açúcar   Refinado ")).toBe("ACUCAR REFINADO");
  });

  it("quantidade decimal compara com três casas, sem erro de ponto flutuante", () => {
    const esperado = nota({ itens: [item("QUEIJO KG", { quantidade: 0.3 })] });
    const obtido = nota({ itens: [item("QUEIJO KG", { quantidade: 0.1 + 0.2 })] });
    expect(errosDaNota(compararNota(esperado, obtido))).toEqual([]);
  });

  it("total errado: erro de documento, e a soma dos itens continua certa", () => {
    const c = compararNota(nota(), nota({ total_centavos: 12100 }));
    expect(c.camposDocumento.total_centavos).toBe(false);
    expect(c.somaItensCorreta).toBe(true);
    expect(errosDaNota(c)).toEqual([{ tipo: "documento", campo: "total_centavos" }]);
  });

  it("CNPJ trocado por outro válido não é percebido pelo dígito verificador, só pelo gabarito", () => {
    const c = compararNota(nota(), nota({ fornecedor: { nome: "Pão Quente Ltda", cnpj: "31482907000168" } }));
    expect(c.camposDocumento.fornecedor_cnpj).toBe(false);
    expect(c.cnpjObtidoValido).toBe(true);
  });

  it("CNPJ com dígito errado fica marcado como inválido", () => {
    const c = compararNota(nota(), nota({ fornecedor: { nome: "Pão Quente Ltda", cnpj: "22786541000121" } }));
    expect(c.cnpjObtidoValido).toBe(false);
    expect(c.camposDocumento.fornecedor_cnpj).toBe(false);
  });

  it("campo de item errado é apontado por campo e posição", () => {
    const obtido = nota({
      itens: [
        item("ARROZ 5KG"),
        item("FEIJAO 1KG", { valor_unitario_centavos: 770, valor_total_centavos: 7700 }),
      ],
    });
    const c = compararNota(nota(), obtido);
    expect(errosDaNota(c)).toEqual([
      { tipo: "item", campo: "valor_unitario_centavos", posicao: 2 },
      { tipo: "item", campo: "valor_total_centavos", posicao: 2 },
    ]);
    expect(c.somaItensCorreta).toBe(false);
    expect(c.campos).toEqual({ certos: 12, total: 14 });
  });

  it("item mal transcrito ainda é comparado com o item certo, pela ordem, sem virar omitido mais a mais", () => {
    const obtido = nota({
      itens: [
        item("ARROZ 5KG"),
        item("FEIJAO 1 KG", { valor_unitario_centavos: 700, valor_total_centavos: 7000 }),
      ],
    });
    const c = compararNota(nota(), obtido);
    expect(errosDaNota(c)).toEqual([{ tipo: "item", campo: "descricao", posicao: 2 }]);
    expect(c.itensSobrando).toEqual([]);
  });

  it("itens fora de ordem casam pela descrição", () => {
    const n = nota();
    const obtido = nota({ itens: [...n.itens].reverse() });
    expect(errosDaNota(compararNota(n, obtido))).toEqual([]);
  });

  it("item omitido: todos os campos dele contam como errados e a soma dos itens falha", () => {
    const c = compararNota(nota(), nota({ itens: [item("ARROZ 5KG")] }));
    expect(errosDaNota(c)).toEqual([{ tipo: "item_omitido", posicao: 2 }]);
    expect(c.itens[1]?.obtido).toBeNull();
    expect(c.somaItensCorreta).toBe(false);
    expect(c.campos).toEqual({ certos: 9, total: 14 });
  });

  it("item a mais na extração vira item sobrando", () => {
    const n = nota();
    const c = compararNota(n, nota({ itens: [...n.itens, item("BRINDE")] }));
    expect(c.itensSobrando.map((i) => i.descricao)).toEqual(["BRINDE"]);
    expect(errosDaNota(c)).toEqual([{ tipo: "item_sobrando", descricao: "BRINDE" }]);
  });
});

describe("classificarConfianca", () => {
  const itemErrado = (confianca: number) =>
    nota({
      itens: [item("ARROZ 5KG", { quantidade: 11, confianca }), nota().itens[1] as ItemExtraido],
    });

  it("erro em item com confiança alta passa em silêncio", () => {
    const conf = classificarConfianca(compararNota(nota(), itemErrado(1)));
    expect(conf.errosSilenciosos).toEqual([{ tipo: "item", campo: "quantidade", posicao: 1 }]);
    expect(conf.errosSinalizados).toEqual([]);
  });

  it("erro em item com confiança abaixo do limite é sinalizado", () => {
    const conf = classificarConfianca(compararNota(nota(), itemErrado(0.5)));
    expect(conf.errosSilenciosos).toEqual([]);
    expect(conf.itensAbaixoDoLimite).toEqual([1]);
  });

  it("confiança igual ao limite não é abaixo dele", () => {
    const c = compararNota(nota(), itemErrado(0.8));
    expect(classificarConfianca(c, 0.8).errosSilenciosos).toHaveLength(1);
    expect(classificarConfianca(c, 0.85).errosSilenciosos).toHaveLength(0);
  });

  it("erro de documento só é sinalizado se o documento sai abaixo do limite", () => {
    const silencioso = classificarConfianca(compararNota(nota(), nota({ total_centavos: 1 })));
    expect(silencioso.errosSilenciosos).toEqual([{ tipo: "documento", campo: "total_centavos" }]);
    const sinalizado = classificarConfianca(
      compararNota(nota(), nota({ total_centavos: 1, confianca_documento: 0.5 })),
    );
    expect(sinalizado.errosSilenciosos).toEqual([]);
    expect(sinalizado.documentoAbaixoDoLimite).toBe(true);
  });

  it("documento abaixo do limite cobre também os erros de item e item omitido", () => {
    const obtido = nota({ itens: [item("ARROZ 5KG", { quantidade: 11 })], confianca_documento: 0.5 });
    expect(classificarConfianca(compararNota(nota(), obtido)).errosSilenciosos).toEqual([]);
  });

  it("pergunta desnecessária: item abaixo do limite, certo e legível no gabarito", () => {
    const obtido = nota({ itens: [item("ARROZ 5KG", { confianca: 0.5 }), nota().itens[1] as ItemExtraido] });
    expect(classificarConfianca(compararNota(nota(), obtido)).itensSinalizadosSemErro).toEqual([1]);
  });

  it("item pouco legível no gabarito, lido certo e abaixo do limite, é a pergunta esperada", () => {
    const esperado = nota({
      itens: [item("ARROZ 5KG", { confianca: 0.5 }), nota().itens[1] as ItemExtraido],
    });
    const conf = classificarConfianca(compararNota(esperado, esperado));
    expect(conf.itensAbaixoDoLimite).toEqual([1]);
    expect(conf.itensSinalizadosSemErro).toEqual([]);
  });
});
