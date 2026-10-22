import { z } from "zod";
import { montarCatalogo } from "./catalogo";
import { definirFerramenta, type ContextoSessao } from "./ferramenta";
import { RegistroFerramentas, type ConfirmacoesConfig } from "./registro-ferramentas";

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

  it.each([
    ["objeto aninhado", z.strictObject({ filtros: z.strictObject({ comerciante_id: z.string() }) })],
    ["lista de objetos", z.strictObject({ itens: z.array(z.strictObject({ comercianteId: z.string() })) })],
    [
      "união",
      z.strictObject({ alvo: z.union([z.string(), z.strictObject({ "comerciante-id": z.string() })]) }),
    ],
    ["opcional", z.strictObject({ filtros: z.strictObject({ comerciante_id: z.string() }).optional() })],
  ])("recusa comerciante_id em qualquer profundidade (%s)", (_cenario, entrada) => {
    const ruim = definirFerramenta({
      nome: "bad_nested",
      descricao: "x",
      entrada,
      efeito: "nenhum",
      executar: async () => null,
    });
    expect(() => new RegistroFerramentas([ruim])).toThrow(/regra 3/);
  });

  describe("efeito escreve_config (regra 7)", () => {
    const executar = jest.fn(async (_ctx: ContextoSessao, e: { preco_centavos: number }) => ({ gravado: e }));
    const definir = definirFerramenta({
      nome: "set_target_price",
      descricao: "Grava o preço-meta de um produto.",
      entrada: z.strictObject({ preco_centavos: z.number().int() }),
      efeito: "escreve_config",
      executar,
    });

    beforeEach(() => executar.mockClear());

    it("não executa sem confirmação do dono (padrão seguro)", async () => {
      const r = new RegistroFerramentas([definir]);
      expect(await r.executar(contexto, "set_target_price", { preco_centavos: 999 })).toMatchObject({
        ok: false,
        erro: /sem confirmação/,
      });
      expect(executar).not.toHaveBeenCalled();
    });

    it("executa depois da confirmação vinda da sessão, e só com ela", async () => {
      const consumir = jest.fn<
        ReturnType<ConfirmacoesConfig["consumir"]>,
        Parameters<ConfirmacoesConfig["consumir"]>
      >();
      consumir.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      const r = new RegistroFerramentas([definir], { consumir });

      expect(await r.executar(contexto, "set_target_price", { preco_centavos: 999 })).toMatchObject({
        ok: true,
      });
      expect(consumir).toHaveBeenCalledWith(contexto, "set_target_price", { preco_centavos: 999 });
      expect(await r.executar(contexto, "set_target_price", { preco_centavos: 999 })).toMatchObject({
        ok: false,
      });
      expect(executar).toHaveBeenCalledTimes(1);
    });

    it("sem confirmação, registra a proposta e devolve a pergunta montada em código, sem executar", async () => {
      const propor = jest.fn(() => Promise.resolve({ perguntaId: "p1", pergunta: "Registro R$ 9,99?" }));
      const r = new RegistroFerramentas([definir], { consumir: () => Promise.resolve(false), propor });
      const res = await r.executar(contexto, "set_target_price", { preco_centavos: 999 });
      expect(res).toMatchObject({
        ok: false,
        erro: expect.stringContaining("Registro R$ 9,99?"),
        confirmacao: { perguntaId: "p1", pergunta: "Registro R$ 9,99?" },
      });
      expect(propor).toHaveBeenCalledWith(contexto, definir, { preco_centavos: 999 });
      expect(executar).not.toHaveBeenCalled();
    });

    it("executarConfirmada roda a escrita validando a entrada e só para escreve_config", async () => {
      const r = new RegistroFerramentas([definir, eco]);
      expect(await r.executarConfirmada(contexto, "set_target_price", { preco_centavos: 999 })).toMatchObject(
        {
          ok: true,
          saida: { gravado: { preco_centavos: 999 } },
        },
      );
      expect(await r.executarConfirmada(contexto, "set_target_price", { preco_centavos: "x" })).toMatchObject(
        {
          ok: false,
          erro: /inválida/,
        },
      );
      expect(await r.executarConfirmada(contexto, "echo_merchant", { texto: "oi" })).toMatchObject({
        ok: false,
        erro: /não confirmável/,
      });
      expect(await r.executarConfirmada(contexto, "nao_existe", {})).toMatchObject({ ok: false });
      expect(executar).toHaveBeenCalledTimes(1);
    });

    it("ferramentas de leitura não pedem confirmação", async () => {
      const consumir = jest.fn();
      const r = new RegistroFerramentas([eco], { consumir });
      expect(await r.executar(contexto, "echo_merchant", { texto: "oi" })).toMatchObject({ ok: true });
      expect(consumir).not.toHaveBeenCalled();
    });
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
  it("não manda à API limite numérico, de tamanho nem de lista: ela os recusa com 400 em modo estrito", () => {
    const comLimites = definirFerramenta({
      nome: "com_limites",
      descricao: "Ferramenta com todos os tipos de limite.",
      entrada: z.strictObject({
        valor: z.number().int().positive().max(10_000_000),
        nome: z.string().min(1).max(40),
        itens: z.array(z.string()).min(1).max(3),
      }),
      efeito: "nenhum",
      executar: () => Promise.resolve({}),
    });
    const [def] = new RegistroFerramentas([comLimites]).definicoesParaModelo();
    const esquema = JSON.stringify(def?.input_schema);
    expect(esquema).not.toMatch(
      /"(exclusiveMinimum|exclusiveMaximum|minimum|maximum|minLength|maxLength|maxItems)"/,
    );
    expect(esquema).not.toContain("$schema");
    expect(def?.input_schema).toMatchObject({ type: "object", additionalProperties: false });
    // O limite vira texto na descrição, para o modelo ainda saber dele.
    expect(esquema).toContain("maximum: 10000000");
  });

  it("o Zod continua barrando o valor fora do limite que saiu do esquema", async () => {
    const limitada = definirFerramenta({
      nome: "limitada",
      descricao: "Teto de dez.",
      entrada: z.strictObject({ valor: z.number().int().max(10) }),
      efeito: "nenhum",
      executar: () => Promise.resolve({ ok: true }),
    });
    const r = new RegistroFerramentas([limitada]);
    expect(await r.executar(contexto, "limitada", { valor: 11 })).toMatchObject({ ok: false });
    expect(await r.executar(contexto, "limitada", { valor: 10 })).toMatchObject({ ok: true });
  });

  it("todas as ferramentas do catálogo geram esquema sem os limites que a API recusa", () => {
    const registro = new RegistroFerramentas(montarCatalogo({ db: {} as never }));
    for (const def of registro.definicoesParaModelo()) {
      expect(JSON.stringify(def.input_schema)).not.toMatch(
        /"(exclusiveMinimum|exclusiveMaximum|minimum|maximum|minLength|maxLength|maxItems)"/,
      );
    }
  });
});
