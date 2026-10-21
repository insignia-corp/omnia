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
  const entradaValida = { campo: "custo_unitario_produto", valor_informado: "12,90" };

  it("entra no registro: esquema sem comerciante_id e efeito escreve_config", () => {
    expect(() => new RegistroFerramentas([ferramenta])).not.toThrow();
    expect(ferramenta.efeito).toBe("escreve_config");
  });

  it("esquema estrito, com lista fechada de campos", () => {
    const aceita = (e: object) => ferramenta.entrada.safeParse(e).success;
    expect(aceita(entradaValida)).toBe(true);
    expect(aceita({ ...entradaValida, pergunta_id: randomUUID() })).toBe(true);
    expect(aceita({ ...entradaValida, comerciante_id: randomUUID() })).toBe(false);
    expect(aceita({ ...entradaValida, produto_id: randomUUID() })).toBe(false);
    expect(aceita({ ...entradaValida, fornecedor_id: randomUUID() })).toBe(false);
    expect(aceita({ ...entradaValida, campo: "preco_meta" })).toBe(false);
    expect(aceita({ ...entradaValida, pergunta_id: "1" })).toBe(false);
  });

  it("o valor chega como texto do dono e é lido em código; o modelo não envia centavos", () => {
    const aceita = (valor: unknown) =>
      ferramenta.entrada.safeParse({ ...entradaValida, valor_informado: valor }).success;
    for (const texto of ["12,90", "R$ 12,90", "1.234,50", "12.9", "8"]) expect(aceita(texto)).toBe(true);
    for (const texto of ["doze reais", "", "   ", "12,90 ou 13", "-", 1290, 12.9, null])
      expect(aceita(texto)).toBe(false);
    expect(ferramenta.entrada.safeParse({ ...entradaValida, valor_centavos: 1290 }).success).toBe(false);
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

  it("valor que não dá para ler volta como entrada inválida, mesmo com confirmação", async () => {
    const registro = new RegistroFerramentas([ferramenta], { consumir: () => Promise.resolve(true) });
    const r = await registro.executar(sessao, "save_owner_answer", {
      ...entradaValida,
      valor_informado: "doze reais",
    });
    expect(r).toMatchObject({ ok: false, erro: expect.stringContaining("Entrada inválida") });
  });
});
