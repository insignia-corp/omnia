import type { EstatisticaGatilho } from "./estatisticas";

/**
 * Premissas de uso de um lojista por mês. Os padrões são os da especificação dos agentes (seção 4):
 * um relatório por dia, 10 perguntas e 14 notas. Mensagem e agregador não têm cotação no repositório,
 * então só entram na conta quando informados.
 */
export interface PremissasMensais {
  relatoriosPorMes: number;
  perguntasPorMes: number;
  notasPorMes: number;
  /** Preço de uma mensagem enviada, em micro-dólares. Sem valor: componente não cotado. */
  custoPorMensagemMicrodolares: number | null;
  /** Mensagens enviadas por mês (o relatório diário, mais as respostas às perguntas). */
  mensagensPorMes: number;
  /** Mensalidade do agregador (Open Finance), em micro-dólares, dividida entre os lojistas. Sem valor: não cotado. */
  agregadorMensalMicrodolares: number | null;
  lojistas: number;
}

export const PREMISSAS_PADRAO: Omit<PremissasMensais, "mensagensPorMes"> = {
  relatoriosPorMes: 30,
  perguntasPorMes: 10,
  notasPorMes: 14,
  custoPorMensagemMicrodolares: null,
  agregadorMensalMicrodolares: null,
  lojistas: 1,
};

export interface LinhaMensal {
  rotulo: string;
  quantidade: number;
  /** Custo médio de uma execução; `null` quando não medido. */
  custoUnitarioMicrodolares: number | null;
  /** Custo do mês; `null` quando algum fator não existe (não medido ou sem cotação). */
  custoMensalMicrodolares: number | null;
}

export interface ProjecaoMensal {
  llm: LinhaMensal[];
  llmTotalMicrodolares: number | null;
  mensagens: LinhaMensal;
  agregador: LinhaMensal;
  /** Soma dos componentes que têm valor; os demais ficam em `naoCotados`. */
  totalCotadoMicrodolares: number | null;
  naoCotados: string[];
}

const multiplicar = (unitario: number | null, quantidade: number): number | null =>
  unitario === null ? null : Math.round(unitario * quantidade);

/**
 * Custo mensal por lojista a partir do custo médio medido por execução. Tudo em micro-dólares inteiros.
 * Execução não medida (ou sem preço) deixa o total do LLM em `null`: nada vira zero em silêncio.
 */
export function projetarMes(medidas: EstatisticaGatilho[], premissas: PremissasMensais): ProjecaoMensal {
  const media = (g: EstatisticaGatilho["gatilho"]) => {
    const m = medidas.find((x) => x.gatilho === g);
    return m && m.execucoes > 0 ? m.custoMedioMicrodolares : null;
  };
  const llm: LinhaMensal[] = [
    {
      rotulo: "Relatório diário",
      quantidade: premissas.relatoriosPorMes,
      gatilho: "relatorio_diario" as const,
    },
    { rotulo: "Pergunta do dono", quantidade: premissas.perguntasPorMes, gatilho: "mensagem_dono" as const },
    { rotulo: "Extração de nota", quantidade: premissas.notasPorMes, gatilho: "extracao_nota" as const },
  ].map(({ rotulo, quantidade, gatilho }) => {
    const unitario = media(gatilho);
    return {
      rotulo,
      quantidade,
      custoUnitarioMicrodolares: unitario,
      custoMensalMicrodolares: multiplicar(unitario, quantidade),
    };
  });
  const llmTotal = llm.some((l) => l.custoMensalMicrodolares === null)
    ? null
    : llm.reduce((s, l) => s + (l.custoMensalMicrodolares ?? 0), 0);

  const mensagens: LinhaMensal = {
    rotulo: "Mensagens do canal",
    quantidade: premissas.mensagensPorMes,
    custoUnitarioMicrodolares: premissas.custoPorMensagemMicrodolares,
    custoMensalMicrodolares: multiplicar(premissas.custoPorMensagemMicrodolares, premissas.mensagensPorMes),
  };
  const agregador: LinhaMensal = {
    rotulo: `Agregador (dividido por ${premissas.lojistas} lojista${premissas.lojistas === 1 ? "" : "s"})`,
    quantidade: 1,
    custoUnitarioMicrodolares:
      premissas.agregadorMensalMicrodolares === null
        ? null
        : Math.round(premissas.agregadorMensalMicrodolares / premissas.lojistas),
    custoMensalMicrodolares:
      premissas.agregadorMensalMicrodolares === null
        ? null
        : Math.round(premissas.agregadorMensalMicrodolares / premissas.lojistas),
  };

  const naoCotados = [
    ...(llmTotal === null ? ["LLM (alguma execução não foi medida ou não tem preço)"] : []),
    ...(mensagens.custoMensalMicrodolares === null ? ["mensagens do canal"] : []),
    ...(agregador.custoMensalMicrodolares === null ? ["agregador"] : []),
  ];
  const componentes = [llmTotal, mensagens.custoMensalMicrodolares, agregador.custoMensalMicrodolares];
  const cotados = componentes.filter((c): c is number => c !== null);
  return {
    llm,
    llmTotalMicrodolares: llmTotal,
    mensagens,
    agregador,
    totalCotadoMicrodolares: cotados.length > 0 ? cotados.reduce((s, c) => s + c, 0) : null,
    naoCotados,
  };
}
