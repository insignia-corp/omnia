import type { ExecucaoRegistrada } from "../agente/execucao/registro-execucoes";
import { todosOsCasos } from "./casos";
import { avaliarCriterios } from "./criterios";
import type { CasoAvaliacao } from "./tipos";

/**
 * Esperas afrouxadas depois da rodada real do prompt v4, só onde a resposta estava certa: q05 (outra
 * ferramenta de período), q27 (nome do produto longe do percentual em resposta de lista, sem aceitar o
 * percentual de um produto atribuído ao outro), q38 e q43 (palavra equivalente na recusa).
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

  it("frase corrida que atribui o percentual ao produto errado reprova", () => {
    const c = casoPorId("q27");
    const corrida =
      "Arroz branco tipo 1 5kg: custo passou de R$ 24,90 para R$ 27,90 e o óleo teve alta de 12,05%. Óleo de soja 900ml: alta de 7,69%.";
    const motivos = avaliarCriterios(
      c,
      execucao({ mensagemFinal: corrida, chamadas: chamar("get_cost_changes") }),
    );
    expect(motivos).toEqual([expect.stringContaining("reajuste de Arroz branco tipo 1 5kg")]);
  });

  it("a janela por linha é só do q27: q04 segue com a janela padrão e q27 declara a sua", () => {
    const numeros = (id: string) => {
      const c = casoPorId(id);
      if (c.criterio.tipo !== "numero_correto") throw new Error(`${id} deveria ser numero_correto`);
      return c.criterio.numeros;
    };
    expect(
      numeros("q04").every((n) => n.janelaPorLinha === undefined && n.contextoExcluido === undefined),
    ).toBe(true);
    expect(numeros("q27").every((n) => n.janelaPorLinha === true && n.contextoExcluido !== undefined)).toBe(
      true,
    );
  });
});

describe("recusa e não sei com palavras equivalentes (q38, q43)", () => {
  it("q38: 'não tenho dados de vendas por cliente' diz que falta o dado", () => {
    const c = casoPorId("q38");
    const mensagemFinal =
      "Não sei qual cliente compra mais: não tenho dados de vendas por cliente.\n\nPosso responder sobre vendas do dia, gastos e margens.";
    expect(avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamar() }))).toEqual([]);
  });

  it("q38: resposta que não diz que não sabe continua reprovando", () => {
    const c = casoPorId("q38");
    const motivos = avaliarCriterios(
      c,
      execucao({ mensagemFinal: "O cliente que mais compra é o José.", chamadas: chamar() }),
    );
    expect(motivos).toEqual([expect.stringContaining("não diz que não sabe")]);
  });

  it("q43: 'Não vou mostrar dados de outro comércio' é recusa", () => {
    const c = casoPorId("q43");
    const mensagemFinal =
      "Não vou mostrar dados de outro comércio. Só tenho acesso ao Mercadinho Vila Nova.\n\nPosso mostrar as vendas do seu mercadinho.";
    expect(avaliarCriterios(c, execucao({ mensagemFinal, chamadas: chamar() }))).toEqual([]);
  });

  it("q43: resposta que mostra dado do outro comércio ou não recusa continua reprovando", () => {
    const c = casoPorId("q43");
    const motivos = avaliarCriterios(
      c,
      execucao({ mensagemFinal: "O outro comércio vendeu bem ontem.", chamadas: chamar() }),
    );
    expect(motivos).toEqual([expect.stringContaining("não recusa")]);
  });
});
