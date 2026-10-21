/**
 * Ticket médio (issue #38): faturamento do dia dividido pelos cupons do dia, contra a média
 * ponderada dos 28 dias anteriores (faturamento total / cupons totais, não a média dos tickets).
 * Fórmula e limites em docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
 */
import { somarDias } from "../lib/datas/datas";
import { indexarVendasPorDia, type IntervaloDeDados, type VendasDoDia } from "./dados-de-metricas";
import { dividirArredondando, percentualDeBps, razaoEmBps } from "./pontos-base";
import { dadoAusente, resultadoMetrica, type DadoAusente, type ResultadoMetrica } from "./resultado-metrica";

/** A base faz parte da definição da métrica e do nome do campo `media_28_dias_centavos`. */
const DIAS_DA_BASE = 28;

/** Quantos dias antes da data o cálculo consulta. */
export const DIAS_DE_HISTORICO_DO_TICKET = DIAS_DA_BASE;

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_TICKET_MEDIO = { limiteQuedaBps: 3000 } as const;
export type ParametrosTicketMedio = { readonly limiteQuedaBps: number };

export interface TicketMedio {
  data: string;
  cupons: number;
  ticket_medio_centavos: number;
  /** Faturamento dos 28 dias anteriores dividido pelos cupons deles, em centavos. */
  media_28_dias_centavos: number;
  /** Positiva quando o ticket do dia ficou abaixo da média, negativa quando ficou acima. */
  queda_bps: number;
  queda_percentual: number;
  /** A queda chega ao limite (30%, no valor inicial). */
  queda_relevante: boolean;
}

export interface EntradaTicketMedio {
  data: string;
  /** Vendas por dia: a função consulta a data e os 28 dias anteriores. */
  vendas: readonly VendasDoDia[];
  intervaloDeVendas: IntervaloDeDados | null;
}

/**
 * Ticket médio do dia contra a média dos 28 anteriores. Devolve dado ausente sem venda no dia,
 * sem os 28 dias de vendas importadas ou sem cupom na base: nunca compara com o que não existe.
 */
export function calcularTicketMedio(
  entrada: EntradaTicketMedio,
  parametros: ParametrosTicketMedio = PARAMETROS_TICKET_MEDIO,
): ResultadoMetrica<TicketMedio> | DadoAusente {
  const { data } = entrada;
  const vendasDe = indexarVendasPorDia(entrada.vendas, entrada.intervaloDeVendas);

  const hoje = vendasDe(data);
  if (!hoje) {
    return dadoAusente(
      "dia_sem_dados",
      `Não há vendas importadas para ${data}.`,
      "Pode enviar a planilha de vendas mais recente?",
    );
  }
  if (hoje.cupons === 0) {
    return dadoAusente("sem_vendas_no_dia", `Não houve venda em ${data}, então não há ticket médio.`);
  }

  const base = Array.from({ length: DIAS_DA_BASE }, (_, i) => vendasDe(somarDias(data, -(i + 1))));
  const diasDaBase = base.filter((dia): dia is VendasDoDia => dia !== null);
  if (diasDaBase.length < DIAS_DA_BASE) {
    return dadoAusente(
      "historico_insuficiente",
      `Faltam vendas importadas em algum dos ${DIAS_DA_BASE} dias anteriores, então não há média para comparar.`,
    );
  }

  const faturamentoDaBase = diasDaBase.reduce((soma, dia) => soma + dia.faturamentoCentavos, 0);
  const cuponsDaBase = diasDaBase.reduce((soma, dia) => soma + dia.cupons, 0);
  const ticket = dividirArredondando(hoje.faturamentoCentavos, hoje.cupons);
  const media = dividirArredondando(faturamentoDaBase, cuponsDaBase);
  const queda = ticket === null || media === null ? null : razaoEmBps(media - ticket, media);
  if (ticket === null || media === null || queda === null) {
    return dadoAusente(
      "sem_base_de_comparacao",
      `Não houve venda nos ${DIAS_DA_BASE} dias anteriores a ${data}, então não há média para comparar.`,
    );
  }

  return resultadoMetrica<TicketMedio>(
    {
      data,
      cupons: hoje.cupons,
      ticket_medio_centavos: ticket,
      media_28_dias_centavos: media,
      queda_bps: queda,
      queda_percentual: percentualDeBps(queda),
      queda_relevante: queda >= parametros.limiteQuedaBps,
    },
    { inicio: somarDias(data, -DIAS_DA_BASE), fim: data },
    [hoje, ...diasDaBase],
  );
}
