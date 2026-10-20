/**
 * Resumo diário (issue #40): faturamento, gastos, saldo e comparação com os dias anteriores. É a
 * base da ferramenta `get_daily_summary` e do relatório diário.
 *
 * Dia sem dado não vira zero: o intervalo de vendas importadas diz quais dias existem. Dentro
 * dele, dia sem cupom é dia sem venda (loja fechada); fora dele, a comparação fica ausente.
 */
import { somarDias } from "../lib/datas/datas";
import type { ContaParaMetrica, IntervaloDeDados, MovimentoDoDia, VendasDoDia } from "./dados-de-metricas";
import { percentualDeBps, razaoEmBps } from "./pontos-base";
import {
  dadoAusente,
  resultadoMetrica,
  type DadoAusente,
  type Procedencia,
  type ResultadoMetrica,
} from "./resultado-metrica";

const DIAS_DA_MEDIA = 7;
const DIAS_DA_SEMANA = 7;

/** Quantos dias antes da data o resumo consulta, para as três comparações. */
export const DIAS_DE_COMPARACAO_DO_RESUMO = Math.max(DIAS_DA_MEDIA, DIAS_DA_SEMANA);

export interface ComparacaoDeFaturamento {
  /** Dia comparado; nulo quando a base é a média de vários dias. */
  data: string | null;
  base_centavos: number;
  /** Nula quando a base é zero, porque a variação não existe. */
  variacao_bps: number | null;
  variacao_percentual: number | null;
}

export interface SaldoDaConta {
  saldo_centavos: number;
}

export interface ResumoDiario {
  data: string;
  faturamento_centavos: number;
  /** Todas as saídas da conta no dia: compras de mercadoria, despesas fixas e operacionais. */
  gastos_centavos: number;
  saldo_do_dia_centavos: number;
  /** Saldo inicial mais as transações até o fim do dia. */
  saldo_da_conta: SaldoDaConta | DadoAusente;
  cupons: number;
  ticket_medio_centavos: number | null;
  comparacao_faturamento: {
    dia_anterior: ComparacaoDeFaturamento | DadoAusente;
    mesmo_dia_semana_anterior: ComparacaoDeFaturamento | DadoAusente;
    media_7_dias_anteriores: ComparacaoDeFaturamento | DadoAusente;
  };
}

export interface EntradaResumoDiario {
  data: string;
  /** Vendas por dia: a função consulta a data e os 7 dias anteriores. */
  vendas: readonly VendasDoDia[];
  intervaloDeVendas: IntervaloDeDados | null;
  /** Movimentos bancários desde a abertura das contas até a data. */
  movimentos: readonly MovimentoDoDia[];
  contas: readonly ContaParaMetrica[];
}

function compararValores(atual: number, base: number): Omit<ComparacaoDeFaturamento, "data"> {
  const bps = razaoEmBps(atual - base, base);
  return {
    base_centavos: base,
    variacao_bps: bps,
    variacao_percentual: bps === null ? null : percentualDeBps(bps),
  };
}

function calcularSaldoDaConta(
  data: string,
  contas: readonly ContaParaMetrica[],
  movimentos: readonly MovimentoDoDia[],
): { saldo: SaldoDaConta; usados: MovimentoDoDia[] } | DadoAusente {
  if (contas.length === 0) {
    return dadoAusente("sem_conta", "Nenhuma conta bancária conectada, então não há saldo.");
  }
  let saldo = 0;
  let contasNaData = 0;
  const usados: MovimentoDoDia[] = [];
  for (const conta of contas) {
    if (conta.saldoInicialCentavos === null || conta.saldoInicialEm === null) {
      return dadoAusente(
        "sem_saldo_inicial",
        "A conta não tem saldo inicial informado, então o saldo é desconhecido.",
      );
    }
    if (data < conta.saldoInicialEm) continue;
    contasNaData++;
    saldo += conta.saldoInicialCentavos;
    for (const m of movimentos) {
      if (m.contaId !== conta.id || m.data < conta.saldoInicialEm || m.data > data) continue;
      saldo += m.tipo === "entrada" ? m.totalCentavos : -m.totalCentavos;
      usados.push(m);
    }
  }
  if (contasNaData === 0) {
    return dadoAusente("conta_posterior_a_data", "Nenhuma conta existia nesta data, então não há saldo.");
  }
  return { saldo: { saldo_centavos: saldo }, usados };
}

/** Resumo de um dia. Devolve dado ausente quando não há vendas importadas para ele. */
export function calcularResumoDiario(
  entrada: EntradaResumoDiario,
): ResultadoMetrica<ResumoDiario> | DadoAusente {
  const { data, intervaloDeVendas: intervalo } = entrada;
  const vendasPorData = new Map(entrada.vendas.map((v) => [v.data, v]));

  /** As vendas do dia; zero dentro do intervalo importado e nulo fora dele. */
  const vendasDe = (dia: string): VendasDoDia | null => {
    if (!intervalo || dia < intervalo.primeira || dia > intervalo.ultima) return null;
    return (
      vendasPorData.get(dia) ?? {
        data: dia,
        cupons: 0,
        faturamentoCentavos: 0,
        registros: 0,
        menorConfianca: null,
        origens: [],
      }
    );
  };

  const hoje = vendasDe(data);
  if (!hoje) {
    return dadoAusente(
      "dia_sem_dados",
      `Não há vendas importadas para ${data}.`,
      "Pode enviar a planilha de vendas mais recente?",
    );
  }
  // Conjunto, porque o dia anterior e o mesmo dia da semana anterior também entram na média.
  const fontes = new Set<Procedencia>([hoje]);

  const comparacaoComDia = (dia: string): ComparacaoDeFaturamento | DadoAusente => {
    const base = vendasDe(dia);
    if (!base)
      return dadoAusente(
        "base_sem_dados",
        `Não há vendas importadas para ${dia}, então não dá para comparar.`,
      );
    fontes.add(base);
    return { data: dia, ...compararValores(hoje.faturamentoCentavos, base.faturamentoCentavos) };
  };

  const diasDaMedia = Array.from({ length: DIAS_DA_MEDIA }, (_, i) => vendasDe(somarDias(data, -(i + 1))));
  const basesDaMedia = diasDaMedia.filter((b): b is VendasDoDia => b !== null);
  let media: ComparacaoDeFaturamento | DadoAusente;
  if (basesDaMedia.length < DIAS_DA_MEDIA) {
    media = dadoAusente(
      "historico_insuficiente",
      `Faltam vendas importadas em algum dos ${DIAS_DA_MEDIA} dias anteriores, então não há média para comparar.`,
    );
  } else {
    for (const base of basesDaMedia) fontes.add(base);
    const soma = basesDaMedia.reduce((s, b) => s + b.faturamentoCentavos, 0);
    media = { data: null, ...compararValores(hoje.faturamentoCentavos, Math.round(soma / DIAS_DA_MEDIA)) };
  }

  const comparacao = {
    dia_anterior: comparacaoComDia(somarDias(data, -1)),
    mesmo_dia_semana_anterior: comparacaoComDia(somarDias(data, -DIAS_DA_SEMANA)),
    media_7_dias_anteriores: media,
  };

  const saidasDoDia = entrada.movimentos.filter((m) => m.data === data && m.tipo === "saida");
  const gastos = saidasDoDia.reduce((soma, m) => soma + m.totalCentavos, 0);
  const saldoDaConta = calcularSaldoDaConta(data, entrada.contas, entrada.movimentos);
  for (const m of saidasDoDia) fontes.add(m);
  if (!("ausente" in saldoDaConta)) for (const m of saldoDaConta.usados) fontes.add(m);

  return resultadoMetrica<ResumoDiario>(
    {
      data,
      faturamento_centavos: hoje.faturamentoCentavos,
      gastos_centavos: gastos,
      saldo_do_dia_centavos: hoje.faturamentoCentavos - gastos,
      saldo_da_conta: "ausente" in saldoDaConta ? saldoDaConta : saldoDaConta.saldo,
      cupons: hoje.cupons,
      ticket_medio_centavos: hoje.cupons > 0 ? Math.round(hoje.faturamentoCentavos / hoje.cupons) : null,
      comparacao_faturamento: comparacao,
    },
    { inicio: somarDias(data, -DIAS_DA_SEMANA), fim: data },
    [...fontes],
  );
}
