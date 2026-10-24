import { avisoDeCusto, percentualDeBpsTexto, textoNotaLida, type NotaParaMensagem } from "./nota-lida";

const nota16: NotaParaMensagem = {
  fornecedor: "Distribuidora Aurora Alimentos",
  data: "2026-10-16",
  totalCentavos: 47370,
  somaItensCentavos: 47370,
  itens: [
    {
      descricao: "ARROZ BCO T1 5KG",
      quantidade: "16.000",
      valorUnitarioCentavos: 2790,
      valorTotalCentavos: 44640,
    },
    {
      descricao: "FARINHA TRIGO 1KG",
      quantidade: "6.000",
      valorUnitarioCentavos: 330,
      valorTotalCentavos: 1980,
    },
    {
      descricao: "SAL REFINADO 1KG",
      quantidade: "6.000",
      valorUnitarioCentavos: 125,
      valorTotalCentavos: 750,
    },
  ],
  avisosDeCusto: [],
  emRevisao: false,
  perguntasPendentes: 0,
  repetida: false,
};

describe("textoNotaLida", () => {
  it("todos os custos iguais: só confirma, sem listar itens", () => {
    expect(textoNotaLida(nota16)).toBe(
      [
        "🧾 *Distribuidora Aurora Alimentos*",
        "3 itens, total *R$ 473,70*",
        "",
        "✅ Tudo certo com os preços.",
      ].join("\n"),
    );
  });

  it("custo diferente: uma linha de atenção por item, sem dizer que está tudo certo", () => {
    const cafe = avisoDeCusto("Café torrado 500g", 1690, 1870)!;
    const acucar = avisoDeCusto("Açúcar refinado 1kg", 309, 299)!;
    expect(textoNotaLida({ ...nota16, avisosDeCusto: [cafe, acucar] })).toBe(
      [
        "🧾 *Distribuidora Aurora Alimentos*",
        "3 itens, total *R$ 473,70*",
        "",
        "⚠️ *Custo diferente da última compra*",
        "• *Café torrado 500g*: de R$ 16,90 para R$ 18,70 (alta de 10,65%)",
        "• *Açúcar refinado 1kg*: de R$ 3,09 para R$ 2,99 (queda de 3,24%)",
      ].join("\n"),
    );
  });

  it("um item só fica no singular", () => {
    expect(textoNotaLida({ ...nota16, itens: [nota16.itens[0]!] })).toContain("\n1 item, total");
  });

  it("soma que não fecha aparece, sem esconder o total da nota", () => {
    expect(textoNotaLida({ ...nota16, somaItensCentavos: 47000 })).toContain(
      "✅ Tudo certo com os preços.\n\nA soma dos itens dá R$ 470,00, diferente do total da nota.",
    );
  });

  it("nota com dúvida avisa que vêm perguntas; em revisão sem pergunta, pede conferência", () => {
    expect(textoNotaLida({ ...nota16, perguntasPendentes: 1 })).toContain("Ficou uma dúvida nesta nota");
    expect(textoNotaLida({ ...nota16, perguntasPendentes: 2 })).toContain(
      "Ficaram 2 dúvidas nesta nota. Te pergunto a seguir.",
    );
    expect(textoNotaLida({ ...nota16, perguntasPendentes: 13 })).toContain(
      "Te pergunto as 3 primeiras a seguir",
    );
    expect(textoNotaLida({ ...nota16, emRevisao: true })).toContain("ficou em dúvida");
  });

  it("nota repetida diz que não contou de novo", () => {
    expect(textoNotaLida({ ...nota16, repetida: true })).toMatch(/^Esta nota já estava no seu histórico/);
  });
});

describe("avisoDeCusto", () => {
  it("alta do café de R$ 16,90 para R$ 18,70 é 10,65%, em pontos-base inteiros", () => {
    expect(avisoDeCusto("Café", 1690, 1870)).toEqual({
      produto: "Café",
      anteriorCentavos: 1690,
      atualCentavos: 1870,
      variacaoBps: 1065,
    });
  });

  it("custo igual ou anterior zero não gera aviso", () => {
    expect(avisoDeCusto("Café", 1690, 1690)).toBeNull();
    expect(avisoDeCusto("Café", 0, 1690)).toBeNull();
  });

  it("queda tem sinal negativo e o texto do percentual não leva sinal", () => {
    expect(avisoDeCusto("Café", 1000, 995)!.variacaoBps).toBe(-50);
    expect(percentualDeBpsTexto(-50)).toBe("0,50");
    expect(percentualDeBpsTexto(1065)).toBe("10,65");
    expect(percentualDeBpsTexto(1000)).toBe("10,00");
  });
});
