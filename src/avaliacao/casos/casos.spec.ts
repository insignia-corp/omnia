import { Logger } from "@nestjs/common";
import { AgenteService } from "../../agente/agente.service";
import type { ExecucaoRegistrada, RegistroExecucoes } from "../../agente/execucao/registro-execucoes";
import { RegistroFerramentas } from "../../agente/ferramentas/registro-ferramentas";
import { carregarPromptSistema } from "../../agente/prompts/prompt-sistema";
import { ModeloRoteirizado } from "../modelo-roteirizado";
import { executarRodada } from "../runner";
import { carregarPerguntas, perguntaPorId } from "./perguntas";
import { todosOsCasos } from "./index";

class RegistroEmMemoria implements RegistroExecucoes {
  private n = 0;
  salvar(_execucao: ExecucaoRegistrada): Promise<string> {
    return Promise.resolve(`exec-${++this.n}`);
  }
}

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

  it("tem ids únicos; só os do verificador (#70) e de medição (#74) ficam fora do gabarito de perguntas", () => {
    const ids = casos.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const doGabarito = carregarPerguntas().map((p) => p.id);
    for (const c of casos) {
      if (c.categoria === "verificador" || c.categoria === "medicao") expect(doGabarito).not.toContain(c.id);
      else expect(doGabarito).toContain(c.id);
    }
  });

  it("cobre as 32 numéricas (#69), as 8 sem resposta (#72) e o verificador (#70)", () => {
    const por = (categoria: string) => casos.filter((c) => c.categoria === categoria);
    expect(por("numerica").map((c) => c.id)).toEqual(
      carregarPerguntas()
        .filter((p) => p.tipo === "numerica")
        .map((p) => p.id),
    );
    expect(por("numerica")).toHaveLength(32);
    expect(por("sem_resposta").map((c) => c.id)).toEqual([
      "q33",
      "q34",
      "q35",
      "q36",
      "q37",
      "q38",
      "q39",
      "q40",
    ]);
    expect(por("verificador").length).toBeGreaterThanOrEqual(5);
  });

  it("todo caso numérico espera exatamente os números, os nomes e as ferramentas do gabarito", () => {
    for (const c of casos.filter((x) => x.categoria === "numerica")) {
      const p = perguntaPorId(c.id);
      expect(c.ferramentasEsperadas).toEqual(p.ferramentas_esperadas);
      if (c.criterio.tipo !== "numero_correto") throw new Error(`${c.id}: critério errado`);
      expect(c.criterio.numeros.map(({ rotulo, valor, unidade }) => ({ rotulo, valor, unidade }))).toEqual(
        p.numeros_esperados,
      );
      expect(c.criterio.textos ?? []).toEqual(p.textos_esperados);
    }
  });

  it("caso sem resposta não espera nenhuma ferramenta nem número", () => {
    for (const c of casos.filter((x) => x.categoria === "sem_resposta")) {
      const p = perguntaPorId(c.id);
      expect(p.numeros_esperados).toEqual([]);
      expect(c.ferramentasEsperadas).toEqual(p.ferramentas_esperadas);
      expect(c.criterio.tipo).toBe("sem_resposta");
    }
  });

  describe("no modo falso, pelo agente de verdade", () => {
    beforeEach(() => {
      jest.spyOn(Logger.prototype, "warn").mockImplementation();
      jest.spyOn(Logger.prototype, "error").mockImplementation();
    });
    afterEach(() => jest.restoreAllMocks());

    it("todos os casos passam", async () => {
      const rodada = await executarRodada({
        casos,
        modo: "falso",
        modelo: "falso-roteirizado",
        versaoPrompt: "sistema-v2",
        comercianteId: "dono-1",
        nomeComercio: "Mercadinho Teste",
        dataReferencia: "2026-10-20",
        registro: new RegistroEmMemoria(),
        agora: () => new Date("2026-10-20T12:00:00Z"),
        criarAgente: (c, registro) =>
          new AgenteService(
            new ModeloRoteirizado(c.roteiro ?? []),
            new RegistroFerramentas(c.ferramentasFalsas ?? []),
            registro,
            carregarPromptSistema(),
            { maxIteracoes: 8, maxRegeracoes: 2 },
          ),
      });
      const reprovados = rodada.resultados
        .filter((r) => !r.aprovado)
        .map((r) => `${r.id}: ${r.motivos.join("; ")}`);
      expect(reprovados).toEqual([]);
      expect(rodada.resultados).toHaveLength(casos.length);
    });
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

describe("caso de medição do relatório diário (#74)", () => {
  const d01 = todosOsCasos().find((c) => c.id === "d01");

  it("usa o gatilho do relatório e mantém os dublês no modo real, ditos na descrição", () => {
    expect(d01?.gatilho).toBe("relatorio_diario");
    expect(d01?.dubleNoModoReal).toBe(true);
    expect(d01?.descricao).toMatch(/dublês/);
    expect(d01?.criterio).toEqual({ tipo: "medicao" });
  });

  it("os dublês cobrem exatamente as ferramentas que o caso espera", () => {
    expect((d01?.ferramentasFalsas ?? []).map((f) => f.nome).sort()).toEqual(
      [...(d01?.ferramentasEsperadas ?? [])].sort(),
    );
  });

  it("só o caso de medição mantém dublê no modo real", () => {
    expect(
      todosOsCasos()
        .filter((c) => c.dubleNoModoReal)
        .map((c) => c.id),
    ).toEqual(["d01"]);
  });
});
