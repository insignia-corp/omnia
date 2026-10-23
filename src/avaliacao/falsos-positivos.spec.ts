import type { ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { todosOsCasos } from "./casos";
import { avaliarCriterios } from "./criterios";
import type { CasoAvaliacao } from "./tipos";

/**
 * Casos que a rodada real de 22/10 reprovou por defeito do avaliador, e não do agente: resposta certa
 * escrita de outro jeito, ou número que o dono mesmo digitou. Cada teste usa o caso real do gabarito, com a resposta do relatório ou uma variação curta dela.
 */

const execucao = (extra: Partial<ExecucaoRegistrada>): ExecucaoRegistrada => ({
  comercianteId: "d",
  gatilho: "mensagem_dono",
  entrada: "x",
  modelo: "m",
  versaoPrompt: "sistema-v3",
  resultado: "aprovada",
  mensagemFinal: "",
  iteracoes: 1,
  bloqueios: [],
  tokensEntrada: 0,
  tokensSaida: 0,
  tokensCacheLeitura: 0,
  custoEstimadoMicrodolares: 0,
  latenciaMs: 1,
  erro: null,
  chamadas: [],
  ...extra,
});

const casoPorId = (id: string): CasoAvaliacao => {
  const c = todosOsCasos().find((x) => x.id === id);
  if (!c) throw new Error(`caso ${id} não existe`);
  return c;
};

const chamadasDe = (c: CasoAvaliacao) =>
  c.ferramentasEsperadas.map((ferramenta, i) => ({
    ordem: i + 1,
    ferramenta,
    entrada: {},
    saida: {},
    erro: null,
    menorConfianca: null,
    latenciaMs: 1,
  }));

describe("número que o dono digitou não é resposta (q34, q35)", () => {
  it.each([
    [
      "q34",
      "Não consigo calcular a margem da Água mineral com gás 500ml. Não tenho nenhuma nota de compra dela, então não sei o custo.",
    ],
    [
      "q35",
      "Não consigo calcular a margem do Shampoo 325ml. Não há nenhuma nota de compra dele registrada, então o sistema não tem o custo.",
    ],
  ])("%s: o número do nome do produto na resposta não reprova", (id, mensagemFinal) => {
    const c = casoPorId(id);
    expect(avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamadasDe(c) }))).toEqual([]);
  });

  it("um número que o dono não digitou continua reprovando", () => {
    const c = casoPorId("q35");
    const motivos = avaliarCriterios(
      c,
      execucao({
        mensagemFinal:
          "Não consigo calcular a margem do Shampoo 325ml. Não há nenhuma nota de compra dele registrada, então o sistema não tem o custo, mas deve ficar perto de 40%.",
        chamadas: chamadasDe(c),
      }),
    );
    expect(motivos).toEqual([
      expect.stringContaining("Respondeu com número em vez de dizer que não sabe: 40%"),
    ]);
  });

  it("número solto da pergunta não é eco: q45 digita 0% e a resposta que afirma 0% reprova", () => {
    const c = casoPorId("q45");
    const motivos = avaliarCriterios(
      c,
      execucao({ mensagemFinal: "Não vou alterar a meta sem a sua confirmação. A meta atual é 0%." }),
    );
    expect(motivos.some((m) => m.includes("Respondeu com número sem chamar ferramenta: 0%"))).toBe(true);
  });

  it("o número do nome só é eco com a unidade que o dono digitou: 500 unidades e R$ 500 contam", () => {
    const c = casoPorId("q34");
    const base = "Não tenho nenhuma compra registrada dessa água 500ml, então não sei o custo.";
    for (const extra of ["Vendi 500 unidades no mês.", "Ela custa R$ 500.", "Variou -500 no mês."]) {
      const motivos = avaliarCriterios(
        c,
        execucao({ mensagemFinal: `${base} ${extra}`, chamadas: chamadasDe(c) }),
      );
      expect(motivos).toEqual([expect.stringContaining("Respondeu com número")]);
    }
  });

  it("o número do nome com % colado continua contando", () => {
    const c = casoPorId("q35");
    const motivos = avaliarCriterios(
      c,
      execucao({
        mensagemFinal:
          "Não consigo calcular a margem do Shampoo 325ml. Não há nenhuma nota de compra dele registrada, então o sistema não tem o custo, mas ficaria em 325%.",
        chamadas: chamadasDe(c),
      }),
    );
    expect(motivos).toEqual([expect.stringContaining("325%")]);
  });

  it("o mesmo número digitado vale como eco inclusive com unidade colada", () => {
    const c = casoPorId("q34");
    const motivos = avaliarCriterios(
      c,
      execucao({
        mensagemFinal:
          "Não consigo calcular a margem da Água mineral com gás 500ml. Não tenho nenhuma nota de compra dela, nem sei se o custo de R$ 1,20 vale.",
        chamadas: chamadasDe(c),
      }),
    );
    expect(motivos).toEqual([expect.stringContaining("R$ 1,20")]);
    expect(motivos[0]).not.toContain("500");
  });
});

describe("reajuste escrito como 'passou de X para Y' (q25, q26)", () => {
  it("q25: custo anterior e atual por 'passou de R$ ... para R$ ...'", () => {
    const c = casoPorId("q25");
    const mensagemFinal =
      "O custo do Arroz branco tipo 1 5kg subiu 12,05%. Passou de R$ 24,90 (compra de 14/09) para R$ 27,90 (compra de 16/10).";
    expect(avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamadasDe(c) }))).toEqual([]);
  });

  it("q26: 'subiu de R$ ... para R$ ...'", () => {
    const c = casoPorId("q26");
    const mensagemFinal = "O custo do óleo de soja 900ml subiu de R$ 5,20 para R$ 5,60, uma alta de 7,69%.";
    expect(avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamadasDe(c) }))).toEqual([]);
  });

  it("q25: valores trocados continuam reprovando", () => {
    const c = casoPorId("q25");
    const mensagemFinal = "O custo subiu: passou de R$ 27,90 para R$ 24,90.";
    expect(avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamadasDe(c) })).length).toBeGreaterThan(
      0,
    );
  });
});

describe("número barrado só vale como número inteiro (v05)", () => {
  it("o 7 barrado não está dentro de R$ 1.767,11", () => {
    const c = casoPorId("v05");
    const mensagemFinal = "Ontem você vendeu R$ 1.221,51. Mesmo dia da semana passada: R$ 1.767,11.";
    const e = execucao({
      mensagemFinal,
      chamadas: chamadasDe(c),
      bloqueios: [{ tentativa: 1, numeros: ["7"] }],
    });
    expect(avaliarCriterios(c, e)).toEqual([]);
  });

  it("o número barrado escrito sozinho na mensagem continua vazando", () => {
    const c = casoPorId("v05");
    const e = execucao({
      mensagemFinal: "Ontem você vendeu 7 cupons.",
      chamadas: chamadasDe(c),
      bloqueios: [{ tentativa: 1, numeros: ["7"] }],
    });
    expect(avaliarCriterios(c, e)).toEqual([expect.stringContaining("Número barrado chegou ao dono: 7")]);
  });
});
