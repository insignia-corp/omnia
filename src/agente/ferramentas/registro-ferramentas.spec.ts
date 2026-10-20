import { z } from "zod";
import { definirFerramenta, type ContextoSessao } from "./ferramenta";
import { RegistroFerramentas } from "./registro-ferramentas";

const contexto: ContextoSessao = {
  comercianteId: "loja-a",
  nomeComercio: "Mercadinho A",
  dataReferencia: "2026-10-19",
};

const eco = definirFerramenta({
  nome: "echo_merchant",
  descricao: "Devolve o comerciante da sessão.",
  entrada: z.strictObject({ texto: z.string() }),
  efeito: "nenhum",
  executar: async (ctx, e) => ({ comerciante: ctx.comercianteId, texto: e.texto }),
});

describe("RegistroFerramentas", () => {
  it("usa o comerciante da sessão, mesmo que o modelo envie outro", async () => {
    const r = new RegistroFerramentas([eco]);
    const res = await r.executar(contexto, "echo_merchant", { texto: "oi", comerciante_id: "loja-b" });
    // strictObject rejeita o campo extra; o comerciante nunca vem do modelo.
    expect(res.ok).toBe(false);
    const ok = await r.executar(contexto, "echo_merchant", { texto: "oi" });
    expect(ok).toMatchObject({ ok: true, saida: { comerciante: "loja-a" } });
  });

  it("recusa registrar ferramenta que recebe comerciante_id do modelo", () => {
    const ruim = definirFerramenta({
      nome: "bad_tool",
      descricao: "x",
      entrada: z.strictObject({ comerciante_id: z.string() }),
      efeito: "nenhum",
      executar: async () => null,
    });
    expect(() => new RegistroFerramentas([ruim])).toThrow(/regra 3/);
  });

  it("devolve erro tratado para ferramenta desconhecida, entrada inválida e exceção", async () => {
    const explode = definirFerramenta({
      nome: "boom",
      descricao: "x",
      entrada: z.strictObject({}),
      efeito: "nenhum",
      executar: async () => {
        throw new Error("banco fora");
      },
    });
    const r = new RegistroFerramentas([eco, explode]);
    expect(await r.executar(contexto, "nao_existe", {})).toMatchObject({ ok: false, erro: /desconhecida/ });
    expect(await r.executar(contexto, "echo_merchant", { texto: 1 })).toMatchObject({
      ok: false,
      erro: /inválida/,
    });
    expect(await r.executar(contexto, "boom", {})).toMatchObject({ ok: false, erro: /banco fora/ });
  });

  it("gera definições estritas e ordenadas para o modelo", () => {
    const r = new RegistroFerramentas([eco]);
    const [def] = r.definicoesParaModelo();
    expect(def).toMatchObject({
      name: "echo_merchant",
      strict: true,
      input_schema: { type: "object", additionalProperties: false, required: ["texto"] },
    });
  });
});
