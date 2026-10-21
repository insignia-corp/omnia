import { randomUUID } from "node:crypto";
import type { Db } from "../../infra/database/database.module";
import { criarSaveOwnerAnswer } from "./save-owner-answer";
import { RegistroFerramentas } from "./registro-ferramentas";

const sessao = { comercianteId: randomUUID(), nomeComercio: "Loja", dataReferencia: "2026-10-20" };

describe("save_owner_answer", () => {
  // Um banco que explode se for tocado: prova que a entrada inválida e a falta de confirmação
  // param antes de qualquer escrita.
  const dbIntocavel = new Proxy({} as Db, {
    get() {
      throw new Error("o banco não devia ser tocado");
    },
  });
  const ferramenta = criarSaveOwnerAnswer(dbIntocavel);
  const entradaValida = { pergunta_id: randomUUID(), campo: "custo_unitario_produto", valor_centavos: 1290 };

  it("entra no registro: esquema sem comerciante_id e efeito escreve_config", () => {
    expect(() => new RegistroFerramentas([ferramenta])).not.toThrow();
    expect(ferramenta.efeito).toBe("escreve_config");
  });

  it("esquema estrito, com lista fechada de campos e dinheiro em centavos inteiros", () => {
    const aceita = (e: object) => ferramenta.entrada.safeParse(e).success;
    expect(aceita(entradaValida)).toBe(true);
    expect(aceita({ ...entradaValida, comerciante_id: randomUUID() })).toBe(false);
    expect(aceita({ ...entradaValida, produto_id: randomUUID() })).toBe(false);
    expect(aceita({ ...entradaValida, campo: "preco_meta" })).toBe(false);
    expect(aceita({ ...entradaValida, valor_centavos: 12.9 })).toBe(false);
    expect(aceita({ ...entradaValida, valor_centavos: -1 })).toBe(false);
    expect(aceita({ ...entradaValida, valor_centavos: "12,90" })).toBe(false);
    expect(aceita({ ...entradaValida, pergunta_id: "1" })).toBe(false);
  });

  it("sem confirmação do dono não executa (regra 7)", async () => {
    const r = await new RegistroFerramentas([ferramenta]).executar(
      sessao,
      "save_owner_answer",
      entradaValida,
    );
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("sem confirmação") });
  });

  it("campo fora da lista volta como entrada inválida, mesmo com confirmação", async () => {
    const registro = new RegistroFerramentas([ferramenta], { consumir: () => Promise.resolve(true) });
    const r = await registro.executar(sessao, "save_owner_answer", { ...entradaValida, campo: "preco_meta" });
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("Entrada inválida") });
  });
});
