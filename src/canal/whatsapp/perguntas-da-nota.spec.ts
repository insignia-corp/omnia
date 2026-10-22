import { randomUUID } from "node:crypto";
import { conferirSaida } from "./regras-meta";
import { acaoDaPergunta, lerAcaoDaPergunta, perguntaParaSaida } from "./perguntas-da-nota";

const id = randomUUID();
const produto = randomUUID();

describe("perguntas da nota na conversa", () => {
  it("item e nota inteira saem com botões de sim e não que levam o id da pergunta", () => {
    for (const tipo of ["confirmar_item", "confirmar_documento"]) {
      const s = perguntaParaSaida({ id, tipo, pergunta: "O valor unitário é R$ 3,30?", contexto: {} });
      expect(conferirSaida(s)).toEqual([]);
      if (s.type !== "interactive" || s.interactive.type !== "button") throw new Error("esperava botões");
      expect(s.interactive.body.text).toBe("O valor unitário é R$ 3,30?");
      expect(s.interactive.action.buttons.map((b) => lerAcaoDaPergunta(b.reply.id))).toEqual([
        { perguntaId: id, tipo: "sim" },
        { perguntaId: id, tipo: "nao" },
      ]);
    }
  });

  it("vínculo sai como lista: sugestão do modelo primeiro, sem repetir produto, e 'Nenhum desses'", () => {
    const outro = randomUUID();
    const s = perguntaParaSaida({
      id,
      tipo: "confirmar_vinculo",
      pergunta: 'O item "PAO FORMA" é qual produto?',
      contexto: {
        sugestao_modelo: { produto_id: produto, nome: "Pão de forma tradicional 500g da padaria" },
        candidatos: [
          { produto_id: produto, nome: "Pão de forma tradicional 500g da padaria" },
          { produto_id: outro, nome: "Pão integral" },
        ],
      },
    });
    expect(conferirSaida(s)).toEqual([]);
    if (s.type !== "interactive" || s.interactive.type !== "list") throw new Error("esperava lista");
    const linhas = s.interactive.action.sections[0]!.rows;
    expect(linhas.map((l) => lerAcaoDaPergunta(l.id))).toEqual([
      { perguntaId: id, tipo: "produto", produtoId: produto },
      { perguntaId: id, tipo: "produto", produtoId: outro },
      { perguntaId: id, tipo: "nao" },
    ]);
    expect(linhas[0]!.title.length).toBeLessThanOrEqual(24);
    expect(linhas[0]!.description).toBe("Pão de forma tradicional 500g da padaria");
  });

  it("contexto sem sugestão ainda deixa responder 'Nenhum desses'", () => {
    const s = perguntaParaSaida({ id, tipo: "confirmar_vinculo", pergunta: "Qual produto?", contexto: {} });
    expect(conferirSaida(s)).toEqual([]);
  });

  it.each([
    null,
    "avisos",
    `pergunta:${id}:talvez`,
    `pergunta:nao-uuid:sim`,
    `pergunta:${id}:produto:x`,
    `pergunta:${id}:sim:extra`,
  ])("%j não é resposta de pergunta", (acao) => {
    expect(lerAcaoDaPergunta(acao)).toBeNull();
  });

  it("o id da ação cabe no limite de id de botão da Meta", () => {
    expect(acaoDaPergunta(id, `produto:${produto}`).length).toBeLessThanOrEqual(256);
  });
});
