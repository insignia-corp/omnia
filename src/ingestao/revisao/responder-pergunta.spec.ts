import { respostaItemSchema } from "./responder-pergunta";

describe("respostaItemSchema", () => {
  it("aceita quantidade com até três casas decimais, a precisão gravada no banco", () => {
    for (const quantidade of [1, 2.5, 1.235, 0.001, 24]) {
      expect(respostaItemSchema.safeParse({ valor_unitario_centavos: 330, quantidade }).success).toBe(true);
    }
  });

  it("recusa quantidade com mais casas que o banco guarda, que deixaria o total diferente do gravado", () => {
    for (const quantidade of [1.2345, 0.0005, 2.0001]) {
      expect(respostaItemSchema.safeParse({ valor_unitario_centavos: 330, quantidade }).success).toBe(false);
    }
  });

  it("recusa quantidade zero ou negativa e campos fora do formato", () => {
    expect(respostaItemSchema.safeParse({ valor_unitario_centavos: 330, quantidade: 0 }).success).toBe(false);
    expect(respostaItemSchema.safeParse({ valor_unitario_centavos: 330, quantidade: -1 }).success).toBe(
      false,
    );
    expect(respostaItemSchema.safeParse({ valor_unitario: 1 }).success).toBe(false);
  });
});
