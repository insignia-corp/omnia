/**
 * Resumo da semana e do mês (issue #182): faturamento, cupons, ticket médio, gastos e saldo de um
 * período, comparado com o período anterior equivalente. É a base da ferramenta `get_period_summary`.
 *
 * - Semana: os 7 dias que terminam na data, contra os 7 dias antes deles.
 * - Mês: do dia 1 do mês até a data, contra os mesmos dias do mês anterior (o fim é limitado ao
 *   último dia dele: 31/03 compara com 01/02 a 28/02).
 *
 * Como no resumo diário, dia sem dado não vira zero: um período com algum dia fora do intervalo de
 * vendas importadas é dado ausente, e os gastos só existem quando o extrato cobre o período inteiro.
 */
import { intervaloDeDatas, somarDias } from "../lib/datas/datas";
import {
  indexarVendasPorDia,
  type IntervaloDeDados,
  type MovimentoDoDia,
  type VendasDoDia,
} from "./dados-de-metricas";
import { percentualDeBps, razaoEmBps } from "./pontos-base";
import {
  dadoAusente,
  resultadoMetrica,
  type DadoAusente,
  type Periodo,
  type Procedencia,
  type ResultadoMetrica,
} from "./resultado-metrica";

export type TipoPeriodo = "semana" | "mes";

const DIAS_DA_SEMANA = 7;

export interface ComparacaoDePeriodo extends Periodo {
  base_centavos: number;
  /** Nula quando a base é zero, porque a variação não existe. */
  variacao_bps: number | null;
  variacao_percentual: number | null;
}

export interface ResumoDePeriodo {
  tipo: TipoPeriodo;
  inicio: string;
  fim: string;
  dias: number;
  faturamento_centavos: number;
  cupons: number;
  ticket_medio_centavos: number | null;
  /** Todas as saídas da conta no período. Ausente quando o extrato não cobre o período inteiro. */
  gastos_centavos: number | DadoAusente;
  /** Faturamento menos gastos; ausente quando os gastos são desconhecidos. */
  saldo_do_periodo_centavos: number | DadoAusente;
  comparacao_faturamento: ComparacaoDePeriodo | DadoAusente;
}

export interface EntradaResumoDePeriodo {
  tipo: TipoPeriodo;
  /** Último dia do período (AAAA-MM-DD), inclusive. */
  ate: string;
  /** Vendas por dia do período e do período anterior. */
  vendas: readonly VendasDoDia[];
  intervaloDeVendas: IntervaloDeDados | null;
  /** Movimentos bancários do período (os de fora são ignorados). */
  movimentos: readonly MovimentoDoDia[];
  /** Datas entre as quais todas as contas exigidas têm extrato; fora delas o gasto é desconhecido. */
  intervaloDeMovimentos: IntervaloDeDados | null;
}

const ultimoDiaDoMes = (ano: number, mes: number): number => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const doisDigitos = (n: number): string => String(n).padStart(2, "0");

/** O período pedido e o anterior equivalente, só com aritmética de datas ISO. */
export function periodosDoResumo(tipo: TipoPeriodo, ate: string): { atual: Periodo; anterior: Periodo } {
  if (tipo === "semana") {
    const inicio = somarDias(ate, -(DIAS_DA_SEMANA - 1));
    return {
      atual: { inicio, fim: ate },
      anterior: { inicio: somarDias(inicio, -DIAS_DA_SEMANA), fim: somarDias(inicio, -1) },
    };
  }
  const [ano, mes, dia] = ate.split("-").map(Number) as [number, number, number];
  const anoAnterior = mes === 1 ? ano - 1 : ano;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const diaFimAnterior = Math.min(dia, ultimoDiaDoMes(anoAnterior, mesAnterior));
  const prefixoAnterior = `${anoAnterior}-${doisDigitos(mesAnterior)}`;
  return {
    atual: { inicio: `${ano}-${doisDigitos(mes)}-01`, fim: ate },
    anterior: { inicio: `${prefixoAnterior}-01`, fim: `${prefixoAnterior}-${doisDigitos(diaFimAnterior)}` },
  };
}

/** Resumo de um período. Devolve dado ausente quando algum dia dele não tem vendas importadas. */
export function calcularResumoDePeriodo(
  entrada: EntradaResumoDePeriodo,
): ResultadoMetrica<ResumoDePeriodo> | DadoAusente {
  const { atual, anterior } = periodosDoResumo(entrada.tipo, entrada.ate);
  const vendasDe = indexarVendasPorDia(entrada.vendas, entrada.intervaloDeVendas);

  const somar = (p: Periodo): { faturamento: number; cupons: number; fontes: VendasDoDia[] } | null => {
    const fontes: VendasDoDia[] = [];
    for (const dia of intervaloDeDatas(p.inicio, p.fim)) {
      const v = vendasDe(dia);
      if (!v) return null;
      fontes.push(v);
    }
    return {
      faturamento: fontes.reduce((s, v) => s + v.faturamentoCentavos, 0),
      cupons: fontes.reduce((s, v) => s + v.cupons, 0),
      fontes,
    };
  };

  const doPeriodo = somar(atual);
  if (!doPeriodo) {
    return dadoAusente(
      "periodo_sem_dados",
      `Faltam vendas importadas em algum dia de ${atual.inicio} a ${atual.fim}, então o total do período seria menor que o real.`,
      "Pode enviar a planilha de vendas mais recente?",
    );
  }
  const fontes: Procedencia[] = [...doPeriodo.fontes];

  const base = somar(anterior);
  let comparacao: ComparacaoDePeriodo | DadoAusente;
  if (!base) {
    comparacao = dadoAusente(
      "base_sem_dados",
      `Faltam vendas importadas em algum dia de ${anterior.inicio} a ${anterior.fim}, então não dá para comparar.`,
    );
  } else {
    fontes.push(...base.fontes);
    const bps = razaoEmBps(doPeriodo.faturamento - base.faturamento, base.faturamento);
    comparacao = {
      ...anterior,
      base_centavos: base.faturamento,
      variacao_bps: bps,
      variacao_percentual: bps === null ? null : percentualDeBps(bps),
    };
  }

  const extrato = entrada.intervaloDeMovimentos;
  const extratoCobre = extrato !== null && atual.inicio >= extrato.primeira && atual.fim <= extrato.ultima;
  const semExtrato = dadoAusente(
    "periodo_sem_extrato",
    `O extrato bancário não cobre todos os dias de ${atual.inicio} a ${atual.fim}, então os gastos e o saldo do período são desconhecidos.`,
    "Pode conectar o banco ou enviar o extrato mais recente?",
  );
  const saidas = extratoCobre
    ? entrada.movimentos.filter((m) => m.tipo === "saida" && m.data >= atual.inicio && m.data <= atual.fim)
    : [];
  fontes.push(...saidas);
  const gastos = saidas.reduce((s, m) => s + m.totalCentavos, 0);

  return resultadoMetrica<ResumoDePeriodo>(
    {
      tipo: entrada.tipo,
      inicio: atual.inicio,
      fim: atual.fim,
      dias: doPeriodo.fontes.length,
      faturamento_centavos: doPeriodo.faturamento,
      cupons: doPeriodo.cupons,
      ticket_medio_centavos:
        doPeriodo.cupons > 0 ? Math.round(doPeriodo.faturamento / doPeriodo.cupons) : null,
      gastos_centavos: extratoCobre ? gastos : semExtrato,
      saldo_do_periodo_centavos: extratoCobre ? doPeriodo.faturamento - gastos : semExtrato,
      comparacao_faturamento: comparacao,
    },
    { inicio: anterior.inicio, fim: atual.fim },
    fontes,
  );
}
