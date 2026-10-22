import { formatarQuantidade, MAX_ITENS_NA_MENSAGEM, textoNotaLida, type NotaParaMensagem } from "./nota-lida";

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
  emRevisao: false,
  perguntasPendentes: 0,
  repetida: false,
};

describe("textoNotaLida", () => {
  it("lista os itens e o total da nota 16 do gabarito, conferindo a soma", () => {
    expect(textoNotaLida(nota16)).toBe(
      [
        "Li a nota da *Distribuidora Aurora Alimentos*, de 16/10:",
        "",
        "• ARROZ BCO T1 5KG: 16 x R$ 27,90 = R$ 446,40",
        "• FARINHA TRIGO 1KG: 6 x R$ 3,30 = R$ 19,80",
        "• SAL REFINADO 1KG: 6 x R$ 1,25 = R$ 7,50",
        "",
        "*Total: R$ 473,70* (confere com a soma dos itens)",
      ].join("\n"),
    );
  });

  it("soma que não fecha aparece, sem esconder o total da nota", () => {
    expect(textoNotaLida({ ...nota16, somaItensCentavos: 47000 })).toContain(
      "*Total: R$ 473,70*, mas a soma dos itens dá R$ 470,00",
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

  it("nota longa mostra os primeiros itens e conta o resto", () => {
    const itens = Array.from({ length: MAX_ITENS_NA_MENSAGEM + 3 }, (_, i) => ({
      ...nota16.itens[0]!,
      descricao: `ITEM ${i}`,
    }));
    const t = textoNotaLida({ ...nota16, itens });
    expect(t).toContain(`ITEM ${MAX_ITENS_NA_MENSAGEM - 1}:`);
    expect(t).not.toContain(`ITEM ${MAX_ITENS_NA_MENSAGEM}:`);
    expect(t).toContain("• e mais 3 itens");
  });
});

describe("formatarQuantidade", () => {
  it.each([
    ["16.000", "16"],
    ["1.500", "1,5"],
    ["0.125", "0,125"],
    ["12", "12"],
  ])("%s vira %s", (q, esperado) => expect(formatarQuantidade(q)).toBe(esperado));
});
