import { montarPerguntaDocumento, montarPerguntaItem, montarPerguntaVinculo } from "./perguntas";

const nota = { descricao: "SALG MILHO 100G", data: "2026-09-30", fornecedor: "Pão Quente" };

describe("perguntas ao dono", () => {
  it("pergunta do item cita descrição, nota, fornecedor e o valor em reais", () => {
    expect(montarPerguntaItem({ ...nota, valorUnitarioCentavos: 330 })).toBe(
      'Não consegui ler bem o item "SALG MILHO 100G" da nota de 2026-09-30 (Pão Quente). O valor unitário é R$ 3,30?',
    );
  });

  it("pergunta do vínculo lista as sugestões, ou só pergunta quando não há", () => {
    expect(
      montarPerguntaVinculo({
        ...nota,
        sugestoes: ["Salgadinho de milho 100g", "Salgadinho de queijo 100g"],
      }),
    ).toBe(
      'Na nota de 2026-09-30 (Pão Quente), o item "SALG MILHO 100G" é qual produto do seu cadastro? Pode ser: Salgadinho de milho 100g; Salgadinho de queijo 100g.',
    );
    expect(montarPerguntaVinculo({ ...nota, sugestoes: [] })).toBe(
      'Na nota de 2026-09-30 (Pão Quente), o item "SALG MILHO 100G" é qual produto do seu cadastro?',
    );
  });

  it("pergunta do documento lista os motivos das conferências, ou cita a leitura ruim", () => {
    const base = { data: "2026-09-30", fornecedor: "Pão Quente" };
    expect(
      montarPerguntaDocumento({ ...base, motivos: ["CNPJ do fornecedor com dígito verificador inválido"] }),
    ).toBe(
      "A nota de 2026-09-30 (Pão Quente) ficou com dúvida: CNPJ do fornecedor com dígito verificador inválido. Os dados da nota estão certos?",
    );
    expect(montarPerguntaDocumento({ ...base, motivos: [] })).toBe(
      "A nota de 2026-09-30 (Pão Quente) ficou com dúvida: A leitura da foto ficou ruim. Os dados da nota estão certos?",
    );
  });
});
