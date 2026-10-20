import { recalcularDocumento, type EstadoDocumento } from "./recalcular-documento";

const base: EstadoDocumento = {
  motivos: [],
  ordemCorrigida: 3,
  somaItensCentavos: 36120,
  totalCentavos: 36120,
  confiancaOriginal: 0.95,
  itensAindaEmRevisao: 0,
  menorConfiancaItem: 0.95,
  limiteConfiancaItem: 0.8,
};

describe("recalcularDocumento", () => {
  it("último item duvidoso corrigido: documento volta para extraido", () => {
    expect(recalcularDocumento(base)).toEqual({ motivos: [], confiancaDocumento: 0.95, status: "extraido" });
  });

  it("a confiança do modelo, que embutia o item ilegível, passa a valer pelos itens depois da correção", () => {
    expect(recalcularDocumento({ ...base, confiancaOriginal: 0.5, menorConfiancaItem: 1 })).toEqual({
      motivos: [],
      confiancaDocumento: 1,
      status: "extraido",
    });
    // Não sobe além do que os itens sustentam.
    expect(
      recalcularDocumento({ ...base, confiancaOriginal: 0.5, menorConfiancaItem: 0.9 }).confiancaDocumento,
    ).toBe(0.9);
  });

  it("ainda há item em revisão: continua em revisão e a confiança não sobe", () => {
    const r = recalcularDocumento({
      ...base,
      confiancaOriginal: 0.5,
      itensAindaEmRevisao: 1,
      menorConfiancaItem: 0.5,
    });
    expect(r).toMatchObject({ confiancaDocumento: 0.5, status: "revisao" });
  });

  it("tira só o motivo do item corrigido", () => {
    const r = recalcularDocumento({
      ...base,
      motivos: [
        { codigo: "item_nao_confere", item: 3, mensagem: "x" },
        { codigo: "item_nao_confere", item: 5, mensagem: "y" },
      ],
      itensAindaEmRevisao: 1,
    });
    expect(r.motivos).toEqual([{ codigo: "item_nao_confere", item: 5, mensagem: "y" }]);
  });

  it("corrigir a leitura errada resolve a divergência da soma e devolve a confiança do modelo", () => {
    const r = recalcularDocumento({
      ...base,
      motivos: [{ codigo: "soma_diverge_do_total", mensagem: "x" }],
      somaItensCentavos: 70880,
      totalCentavos: 70880,
    });
    expect(r).toEqual({ motivos: [], confiancaDocumento: 0.95, status: "extraido" });
  });

  it("corrigir para um valor que ainda não fecha mantém, ou cria, o motivo e a confiança baixa", () => {
    const r = recalcularDocumento({ ...base, somaItensCentavos: 69640, totalCentavos: 70880 });
    expect(r.motivos.map((m) => m.codigo)).toEqual(["soma_diverge_do_total"]);
    expect(r.confiancaDocumento).toBe(0.5);
    // Confiança baixa do documento mantém a revisão: a pergunta do documento é a saída.
    expect(r.status).toBe("revisao");
  });

  it("motivo de CNPJ não some quando o dono corrige um item", () => {
    const r = recalcularDocumento({ ...base, motivos: [{ codigo: "cnpj_invalido", mensagem: "x" }] });
    expect(r.motivos.map((m) => m.codigo)).toEqual(["cnpj_invalido"]);
    expect(r.confiancaDocumento).toBe(0.5);
    expect(r.status).toBe("revisao");
  });

  it("aceita diferença de poucos centavos na soma", () => {
    expect(recalcularDocumento({ ...base, somaItensCentavos: 36125 }).motivos).toEqual([]);
  });

  it("nota confirmada pelo dono: os motivos ficam na lista, mas a confiança deixa de ser reduzida", () => {
    const motivos = [
      { codigo: "cnpj_invalido" as const, mensagem: "x" },
      { codigo: "documento_confirmado" as const, mensagem: "y" },
    ];
    const r = recalcularDocumento({ ...base, motivos, ordemCorrigida: 0 });
    expect(r.motivos).toEqual(motivos);
    expect(r).toMatchObject({ confiancaDocumento: 0.95, status: "extraido" });
  });

  it("nota confirmada com item ainda em revisão continua em revisão, pelo item", () => {
    const r = recalcularDocumento({
      ...base,
      motivos: [{ codigo: "documento_confirmado", mensagem: "y" }],
      ordemCorrigida: 0,
      itensAindaEmRevisao: 1,
    });
    expect(r.status).toBe("revisao");
  });
});
