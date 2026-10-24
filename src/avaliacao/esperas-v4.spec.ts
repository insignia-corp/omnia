import type { ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { todosOsCasos } from "./casos";
import { avaliarCriterios } from "./criterios";
import type { CasoAvaliacao } from "./tipos";

/**
 * Esperas afrouxadas depois da rodada real do prompt v4, só onde a resposta estava certa: q05 (outra
 * ferramenta de período) e q27 (nome do produto longe do percentual em resposta de lista).
 */

const execucao = (extra: Partial<ExecucaoRegistrada>): ExecucaoRegistrada => ({
  comercianteId: "d",
  gatilho: "mensagem_dono",
  entrada: "x",
  modelo: "m",
  versaoPrompt: "sistema-v4",
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

describe("q05: get_period_summary vale no lugar de get_daily_summary", () => {
  const resposta =
    "Nos últimos 7 dias você vendeu R$ 11.709,42, em 447 cupons. Na semana anterior você vendeu R$ 11.939,45.";

  it("aceita a ferramenta de período quando o total está certo", () => {
    const c = casoPorId("q05");
    const motivos = avaliarCriterios(
      c,
      execucao({ mensagemFinal: resposta, chamadas: chamar("get_period_summary") }),
    );
    expect(motivos).toEqual([]);
  });

  it("sem nenhuma das duas ferramentas continua reprovando, e total errado também", () => {
    const c = casoPorId("q05");
    expect(
      faltaFerramenta(
        avaliarCriterios(c, execucao({ mensagemFinal: resposta, chamadas: chamar("get_top_products") })),
        "get_daily_summary",
      ),
    ).toBe(true);
    const errado = avaliarCriterios(
      c,
      execucao({
        mensagemFinal: "Nos últimos 7 dias você vendeu R$ 9.999,00.",
        chamadas: chamar("get_period_summary"),
      }),
    );
    expect(errado).toEqual([expect.stringContaining("Número ausente ou errado")]);
  });

  it("a equivalência não vale para outros casos que pedem get_daily_summary (q12)", () => {
    const c = casoPorId("q12");
    const motivos = avaliarCriterios(c, execucao({ chamadas: chamar("get_period_summary") }));
    expect(faltaFerramenta(motivos, "get_daily_summary")).toBe(true);
  });
});

describe("q27: o nome do produto abre o item e o percentual vem depois de preços e datas", () => {
  const lista =
    "Sim, a Distribuidora Aurora Alimentos Ltda reajustou o custo de 2 produtos:\n\n" +
    "- **Arroz branco tipo 1 5kg:** o custo foi de R$ 24,90 (compra de 2026-09-14) para R$ 27,90 (compra de 2026-10-16), alta de 12,05%.\n" +
    "- **Óleo de soja 900ml:** o custo foi de R$ 5,20 (compra de 2026-09-14) para R$ 5,60 (compra de 2026-10-13), alta de 7,69%.";

  it("aceita a resposta de lista com cada percentual no item do seu produto", () => {
    const c = casoPorId("q27");
    expect(
      avaliarCriterios(c, execucao({ mensagemFinal: lista, chamadas: chamar("get_cost_changes") })),
    ).toEqual([]);
  });

  it("percentuais trocados entre os produtos continuam reprovando", () => {
    const c = casoPorId("q27");
    const trocada = lista.replace("12,05%", "TMP").replace("7,69%", "12,05%").replace("TMP", "7,69%");
    const motivos = avaliarCriterios(
      c,
      execucao({ mensagemFinal: trocada, chamadas: chamar("get_cost_changes") }),
    );
    expect(motivos.length).toBeGreaterThan(0);
    expect(motivos.every((m) => m.startsWith("Número ausente ou errado"))).toBe(true);
  });

  it("a janela maior é só do q27: q04 segue com a janela padrão", () => {
    const c = casoPorId("q04");
    if (c.criterio.tipo !== "numero_correto") throw new Error("q04 deveria ser numero_correto");
    expect(c.criterio.numeros.every((n) => n.janelaAntes === undefined)).toBe(true);
  });
});
