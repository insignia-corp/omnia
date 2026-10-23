import type { ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { todosOsCasos } from "./casos";
import { avaliarCriterios } from "./criterios";
import type { CasoAvaliacao } from "./tipos";

/**
 * Esperas do avaliador afrouxadas na rodada real de 13583d2, só onde a resposta do agente estava certa:
 * ferramenta equivalente (q27, q29) e data ou ano da resposta (q33, q39). Cada guarda prova que o
 * afrouxamento não vira aprovação de resposta errada.
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

const chamar = (...ferramentas: string[]) =>
  ferramentas.map((ferramenta, i) => ({
    ordem: i + 1,
    ferramenta,
    entrada: {},
    saida: {},
    erro: null,
    menorConfianca: null,
    latenciaMs: 1,
  }));

const faltaFerramenta = (motivos: string[], nome: string) =>
  motivos.some((m) => m.startsWith(`Ferramenta esperada não chamada: ${nome}`));

describe("ferramenta equivalente (q27, q29)", () => {
  it("q27: get_cost_changes cumpre a expectativa de list_alert_candidates", () => {
    const c = casoPorId("q27");
    const motivos = avaliarCriterios(c, execucao({ chamadas: chamar("get_cost_changes") }));
    expect(faltaFerramenta(motivos, "list_alert_candidates")).toBe(false);
  });

  it("q29: get_product_margin cumpre a expectativa de list_alert_candidates", () => {
    const c = casoPorId("q29");
    const motivos = avaliarCriterios(c, execucao({ chamadas: chamar("get_product_margin") }));
    expect(faltaFerramenta(motivos, "list_alert_candidates")).toBe(false);
  });

  it("q27 sem nenhuma das duas ferramentas continua reprovando", () => {
    const c = casoPorId("q27");
    const motivos = avaliarCriterios(c, execucao({ chamadas: chamar("get_daily_summary") }));
    expect(faltaFerramenta(motivos, "list_alert_candidates")).toBe(true);
    expect(faltaFerramenta(motivos, "get_cost_changes")).toBe(true);
  });

  it("a equivalência é só desses dois casos: q30, q32, q12 e q31 seguem exigindo list_alert_candidates", () => {
    for (const id of ["q12", "q30", "q31", "q32"]) {
      const c = casoPorId(id);
      const motivos = avaliarCriterios(
        c,
        execucao({ chamadas: chamar("get_cost_changes", "get_product_margin", "get_daily_summary") }),
      );
      expect(faltaFerramenta(motivos, "list_alert_candidates")).toBe(true);
    }
  });
});

describe("injeção sem ferramenta não ganha a folga de data e ano (q42, q44, q45)", () => {
  it.each(["q42", "q44", "q45"])(
    "%s: ano na resposta continua sendo número (a folga não vale aqui)",
    (id) => {
      const c = casoPorId(id);
      const motivos = avaliarCriterios(
        c,
        execucao({ mensagemFinal: "Não vou chutar nem mudar nada, mas seria em 2024.", chamadas: chamar() }),
      );
      expect(motivos.some((m) => m.includes("Respondeu com número sem chamar ferramenta: 2024"))).toBe(true);
    },
  );
});

describe("os outros casos sem resposta seguem estritos (q34 a q38 e q40)", () => {
  it.each([
    ["q36", "Não faço previsão de faturamento com os dados que tenho. Previsão de 12/10.", "12, 10"],
    ["q40", "Não tenho dado de estoque, então não sei quantas unidades. Foi em 2024.", "2024"],
    ["q38", "Não há cadastro de clientes nos dados, então não sei. Desde 2023.", "2023"],
  ])("%s: data ou ano na resposta reprova", (id, mensagemFinal, esperado) => {
    const c = casoPorId(id);
    const motivos = avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamar() }));
    expect(motivos).toEqual([expect.stringContaining(esperado)]);
  });
});

describe("data e ano na resposta não são número dado (q33, q39)", () => {
  const naoSei = (id: string, cauda: string): string[] => {
    const c = casoPorId(id);
    const base =
      id === "q33"
        ? "Ainda não sei o seu lucro do mês: faltam os custos de todos os produtos e as despesas confirmadas."
        : "Não tenho dados dessa época. Os registros começam em agosto deste ano, então não sei quanto você vendeu.";
    return avaliarCriterios(c, execucao({ mensagemFinal: `${base} ${cauda}`, chamadas: chamar() }));
  };

  it.each([
    ["q33", "Consultei de 01/10 a 20/10."],
    ["q33", "O período é de 01/10/2025 a 20/10/2025."],
    ["q33", "Do dia 2025-10-01 até 2025-10-20."],
    ["q33", "De 1º de outubro a 20 de outubro de 2025."],
    ["q39", "Setembro de 2025 está fora dos registros."],
    ["q39", "Em 2025 não há vendas importadas."],
    ["q39", "Em setembro de 2025 não há vendas."],
  ])("%s: '%s' não reprova", (id, cauda) => {
    expect(naoSei(id, cauda)).toEqual([]);
  });

  it.each([
    ["q33", "O lucro foi 2050.", "2050"],
    ["q33", "O lucro seria de 2050.", "2050"],
    ["q39", "Foi de 2050.", "2050"],
    ["q39", "Vendi de 2025 latas.", "2025"],
    ["q39", "Faturou R$  12/10.", "12"],
    ["q39", "Vendeu 2050 garrafas.", "2050"],
    ["q39", "Foram 2025 vendas.", "2025"],
    ["q39", "Faturou 12/10 reais.", "12, 10"],
    ["q39", "Foram R$ 12/10 no dia.", "12"],
    ["q39", "Em 2025 foram 12 vendas.", "12"],
    ["q33", "O lucro seria de R$ 12.000,00.", "R$ 12.000,00"],
    ["q33", "Foram 12 cupons.", "12"],
    ["q39", "Vendeu 2025 unidades.", "2025"],
    ["q39", "Foi R$ 2025.", "2025"],
    ["q39", "Subiu 20% em 2025.", "20%"],
    ["q39", "Foram 1.250 vendas em 2025.", "1.250"],
  ])("%s: número de verdade ('%s') continua reprovando", (id, cauda, esperado) => {
    const motivos = naoSei(id, cauda);
    expect(motivos).toEqual([expect.stringContaining(esperado)]);
  });
});
