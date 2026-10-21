import { ModeloRoteirizado } from "../modelo-roteirizado";
import { carregarPerguntas, perguntaPorId } from "./perguntas";
import { todosOsCasos } from "./index";

describe("perguntas do gabarito", () => {
  it("carrega as 46 perguntas com o esquema esperado", () => {
    const perguntas = carregarPerguntas();
    expect(perguntas).toHaveLength(46);
    expect(new Set(perguntas.map((p) => p.id)).size).toBe(46);
  });

  it("pergunta inexistente falha com o id", () => {
    expect(() => perguntaPorId("q99")).toThrow("q99");
  });
});

describe("casos da rodada", () => {
  const casos = todosOsCasos();

  it("tem ids únicos e vem do gabarito", () => {
    const ids = casos.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of casos) expect(carregarPerguntas().map((p) => p.id)).toContain(c.id);
  });

  it("o número esperado do caso numérico é o do gabarito, nunca digitado à mão", () => {
    const q01 = casos.find((c) => c.id === "q01");
    expect(q01?.criterio).toEqual({
      tipo: "numero_correto",
      numeros: perguntaPorId("q01").numeros_esperados,
    });
    expect(q01?.ferramentasEsperadas).toEqual(perguntaPorId("q01").ferramentas_esperadas);
  });

  it("todo caso tem roteiro para o modo falso e o roteiro termina em texto", async () => {
    for (const c of casos) {
      expect(c.roteiro?.length).toBeGreaterThan(0);
      const ultimo = c.roteiro?.at(-1);
      expect(ultimo?.stop_reason).toBe("end_turn");
      // O roteiro é copiado por modelo: rodar duas vezes o mesmo caso não o consome.
      await new ModeloRoteirizado(c.roteiro ?? []).gerar({ system: "", messages: [], tools: [] });
      expect(c.roteiro?.length).toBeGreaterThan(0);
    }
  });
});
