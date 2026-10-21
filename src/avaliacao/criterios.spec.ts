import type { BloqueioVerificador, ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { avaliarCriterios, dataIsoValida, validarCaso } from "./criterios";
import type { CasoAvaliacao, Criterio } from "./tipos";

const execucao = (extra: Partial<ExecucaoRegistrada> = {}): ExecucaoRegistrada => ({
  comercianteId: "d",
  gatilho: "mensagem_dono",
  entrada: "x",
  modelo: "m",
  versaoPrompt: "sistema-v2",
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

const caso = (criterio: Criterio, ferramentasEsperadas: string[] = []): CasoAvaliacao => ({
  id: "c",
  categoria: "numerica",
  descricao: "d",
  gatilho: "mensagem_dono",
  entrada: "e",
  ferramentasEsperadas,
  criterio,
});

const chamada = (ferramenta: string) => ({
  ordem: 1,
  ferramenta,
  entrada: {},
  saida: {},
  erro: null,
  menorConfianca: null,
  latenciaMs: 1,
});

describe("numero_correto", () => {
  const numeros = (...n: Array<[number, "centavos" | "cupons" | "percentual"]>): Criterio => ({
    tipo: "numero_correto",
    numeros: n.map(([valor, unidade], i) => ({ rotulo: `n${i}`, valor, unidade })),
  });

  it("aceita dinheiro em reais para centavos do gabarito, inteiro para contagem e módulo para percentual", () => {
    const c = caso(numeros([122151, "centavos"], [78, "cupons"], [43.12, "percentual"]));
    const e = execucao({
      mensagemFinal: "Vendeu R$ 1.221,51 em 78 vendas e o ticket caiu 43,12%.",
    });
    expect(avaliarCriterios(c, e)).toEqual([]);
  });

  it("percentual negativo do gabarito casa com o módulo escrito na mensagem", () => {
    const c = caso(numeros([-30.23, "percentual"]));
    expect(avaliarCriterios(c, execucao({ mensagemFinal: "O faturamento ficou 30,23% menor." }))).toEqual([]);
  });

  it("aponta o número que falta, mesmo que outros estejam certos", () => {
    const c = caso(numeros([122151, "centavos"], [78, "cupons"]));
    const motivos = avaliarCriterios(c, execucao({ mensagemFinal: "Vendeu R$ 1.221,51." }));
    expect(motivos).toEqual([expect.stringContaining("n1 (78 cupons)")]);
  });

  it("valor em centavos escrito como se fosse reais não conta", () => {
    const c = caso(numeros([122151, "centavos"]));
    expect(avaliarCriterios(c, execucao({ mensagemFinal: "Vendeu R$ 122.151,00." }))).toHaveLength(1);
  });

  it("reprova quando a execução não terminou aprovada, com o erro registrado", () => {
    const c = caso(numeros([1, "cupons"]));
    const e = execucao({
      resultado: "fallback_erro",
      erro: "Error: timeout",
      mensagemFinal: "Tive um problema",
    });
    expect(avaliarCriterios(c, e)).toEqual(["Execução terminou em fallback_erro: Error: timeout"]);
  });
});

describe("numero_correto: o valor tem de estar no lugar certo", () => {
  const ticket: Criterio = {
    tipo: "numero_correto",
    numeros: [
      { rotulo: "ticket de ontem", valor: 1566, unidade: "centavos", contexto: /ontem/i },
      {
        rotulo: "ticket dos 28 dias anteriores",
        valor: 2753,
        unidade: "centavos",
        contexto: /28 dias|anteriores/i,
      },
    ],
  };

  it("passa quando cada valor está junto das suas palavras", () => {
    const e = execucao({
      mensagemFinal: "O ticket médio de ontem foi R$ 15,66, contra R$ 27,53 dos 28 dias anteriores.",
    });
    expect(avaliarCriterios(caso(ticket), e)).toEqual([]);
  });

  it("reprova os valores trocados, que só conferindo o valor passariam", () => {
    const e = execucao({
      mensagemFinal: "O ticket médio de ontem foi R$ 27,53, contra R$ 15,66 dos 28 dias anteriores.",
    });
    expect(avaliarCriterios(caso(ticket), e)).toEqual([
      expect.stringContaining("ticket de ontem"),
      expect.stringContaining("ticket dos 28 dias anteriores"),
    ]);
  });

  it("aceita a palavra depois do número", () => {
    const e = execucao({
      mensagemFinal: "R$ 15,66 foi o ticket de ontem; a média dos 28 dias anteriores ficou em R$ 27,53.",
    });
    expect(avaliarCriterios(caso(ticket), e)).toEqual([]);
  });
});

describe("validarCaso", () => {
  const numeros = (...n: Array<{ valor: number; contexto?: RegExp }>): CasoAvaliacao =>
    caso({
      tipo: "numero_correto",
      numeros: n.map((x, i) => ({ rotulo: `n${i}`, unidade: "centavos" as const, ...x })),
    });

  it("recusa dois números da mesma unidade sem contexto, pois um valor trocado passaria", () => {
    const problemas = validarCaso(numeros({ valor: 1 }, { valor: 2 }));
    expect(problemas).toEqual([expect.stringContaining("Critério ambíguo")]);
    expect(
      avaliarCriterios(
        numeros({ valor: 100 }, { valor: 200 }),
        execucao({ mensagemFinal: "R$ 1,00 e R$ 2,00" }),
      ),
    ).toEqual([expect.stringContaining("Critério ambíguo")]);
  });

  it("aceita unidades diferentes sem contexto e valores da mesma unidade com contexto", () => {
    const misto = caso({
      tipo: "numero_correto",
      numeros: [
        { rotulo: "a", valor: 1, unidade: "centavos" },
        { rotulo: "b", valor: 2, unidade: "cupons" },
      ],
    });
    expect(validarCaso(misto)).toEqual([]);
    expect(validarCaso(numeros({ valor: 1, contexto: /a/ }, { valor: 2, contexto: /b/ }))).toEqual([]);
  });

  it("recusa data de referência que não existe no calendário", () => {
    expect(validarCaso({ ...caso({ tipo: "sem_resposta" }), dataReferencia: "2026-02-30" })).toEqual([
      expect.stringContaining("2026-02-30"),
    ]);
  });
});

describe("dataIsoValida", () => {
  it("só aceita data de calendário em AAAA-MM-DD", () => {
    expect(dataIsoValida("2026-10-20")).toBe(true);
    expect(dataIsoValida("2028-02-29")).toBe(true);
    for (const ruim of [
      "2026-02-30",
      "2026-13-01",
      "2026-10-32",
      "26-10-20",
      "2026-1-5",
      "20/10/2026",
      "",
      "2026-10-20x",
    ]) {
      expect(dataIsoValida(ruim)).toBe(false);
    }
  });
});

describe("ferramentas esperadas", () => {
  it("todas precisam ter sido chamadas", () => {
    const c = caso({ tipo: "sem_resposta" }, ["a", "b"]);
    const e = execucao({ mensagemFinal: "Não sei.", chamadas: [chamada("a")] });
    expect(avaliarCriterios(c, e)).toEqual([expect.stringContaining("Ferramenta esperada não chamada: b")]);
  });
});

describe("bloqueio_verificador", () => {
  const bloqueio: BloqueioVerificador = { tentativa: 1, numeros: ["R$ 31,00"] };
  const criterio: Criterio = { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "aprovada" };

  it("passa quando barrou e a versão corrigida não traz o número barrado", () => {
    const e = execucao({ bloqueios: [bloqueio], mensagemFinal: "O arroz custa R$ 27,90." });
    expect(avaliarCriterios(caso(criterio), e)).toEqual([]);
  });

  it("reprova quando o verificador não barrou nada", () => {
    const e = execucao({ mensagemFinal: "O arroz custa R$ 27,90." });
    expect(avaliarCriterios(caso(criterio), e)[0]).toContain("Verificador não bloqueou");
  });

  it("reprova quando o número barrado chegou ao dono", () => {
    const e = execucao({ bloqueios: [bloqueio], mensagemFinal: "O arroz custa R$ 31,00." });
    expect(avaliarCriterios(caso(criterio), e)).toEqual(["Número barrado chegou ao dono: R$ 31,00"]);
  });

  it("no fallback do verificador a mensagem não pode ter número", () => {
    const c = caso({ tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "fallback_verificador" });
    const bom = execucao({
      bloqueios: [bloqueio],
      resultado: "fallback_verificador",
      mensagemFinal: "Prefiro não arriscar.",
    });
    const ruim = execucao({
      bloqueios: [bloqueio],
      resultado: "fallback_verificador",
      mensagemFinal: "Prefiro não arriscar (2).",
    });
    expect(avaliarCriterios(c, bom)).toEqual([]);
    expect(avaliarCriterios(c, ruim)).toEqual(["O fallback do verificador contém número"]);
  });

  it("reprova quando o resultado final é outro", () => {
    const e = execucao({
      bloqueios: [bloqueio],
      resultado: "fallback_verificador",
      mensagemFinal: "Prefiro não arriscar.",
    });
    expect(avaliarCriterios(caso(criterio), e)).toEqual([
      "Resultado fallback_verificador, esperado aprovada",
    ]);
  });
});

describe("sem_resposta", () => {
  const c = caso({ tipo: "sem_resposta" });

  it("passa quando diz que não sabe, diz o que falta e não traz número", () => {
    const e = execucao({
      mensagemFinal: "Ainda não sei o lucro do mês: faltam os custos de todos os produtos.",
    });
    expect(avaliarCriterios(c, e)).toEqual([]);
  });

  it("reprova quando responde com número", () => {
    const e = execucao({ mensagemFinal: "Não sei ao certo, mas deve ser uns R$ 5.000,00." });
    expect(avaliarCriterios(c, e)).toEqual([expect.stringContaining("Respondeu com número")]);
  });

  it("reprova quando não diz que não sabe", () => {
    const e = execucao({ mensagemFinal: "Seu mês foi ótimo, parabéns!" });
    expect(avaliarCriterios(c, e)).toEqual(["A mensagem não diz que não sabe nem que dado falta"]);
  });

  it("não confunde 'não tenho dúvidas' com falta de dado", () => {
    const e = execucao({ mensagemFinal: "Não tenho dúvidas: seu lucro foi excelente." });
    expect(avaliarCriterios(c, e)).toEqual(["A mensagem não diz que não sabe nem que dado falta"]);
  });

  it("aceita as formas comuns de dizer que falta dado", () => {
    for (const frase of [
      "Não sei responder isso.",
      "Não tenho os custos de todos os produtos.",
      "Não encontrei registros dessa semana.",
      "Faltam as despesas confirmadas.",
      "Sem dados para esse período.",
    ]) {
      expect(avaliarCriterios(c, execucao({ mensagemFinal: frase }))).toEqual([]);
    }
  });

  it("aceita um padrão próprio do caso", () => {
    const e = execucao({ mensagemFinal: "Isso eu desconheço." });
    expect(avaliarCriterios(caso({ tipo: "sem_resposta", padraoNaoSei: /desconheço/ }), e)).toEqual([]);
  });
});
