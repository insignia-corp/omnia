/**
 * Um dia contra os mesmos dias da semana anteriores (resumo diário do pitch): faturamento, vendas e
 * ticket médio do dia contra a média das 3 semanas anteriores no mesmo dia (a sexta contra as 3
 * sextas anteriores). Comparar com o mesmo dia da semana tira o efeito do dia (sábado vende mais).
 */
import { somarDias } from "../lib/datas/datas";
import { indexarVendasPorDia, type IntervaloDeDados, type VendasDoDia } from "./dados-de-metricas";
import { dividirArredondando, percentualDeBps, razaoEmBps } from "./pontos-base";
import { dadoAusente, resultadoMetrica, type DadoAusente, type ResultadoMetrica } from "./resultado-metrica";

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_DIA_CONTRA_MESMOS_DIAS = { semanasAnteriores: 3 } as const;
export type ParametrosDiaContraMesmosDias = { readonly semanasAnteriores: number };

const DIAS_DA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"] as const;
export type DiaDaSemana = (typeof DIAS_DA_SEMANA)[number];

/** Nome do dia da semana de uma data ISO, em UTC como o resto de `lib/datas`. */
export function diaDaSemana(data: string): DiaDaSemana {
  return DIAS_DA_SEMANA[new Date(`${data}T00:00:00Z`).getUTCDay()] ?? "domingo";
}

export interface NumerosDoDia {
  faturamento_centavos: number;
  /** Cupons do dia. */
  vendas: number;
  ticket_medio_centavos: number;
}

export interface DiaContraMesmosDias {
  data: string;
  dia_da_semana: DiaDaSemana;
  dia: NumerosDoDia;
  mesmos_dias_anteriores: {
    /** Quantas semanas entram na média: o número de "as últimas 3 sextas", para o verificador aceitar. */
    semanas: number;
    /** Do mais recente para o mais antigo. */
    datas: string[];
    /** Médias arredondadas para inteiro; o ticket é ponderado (faturamento total / vendas totais). */
    media_faturamento_centavos: number;
    media_vendas: number;
    media_ticket_medio_centavos: number;
  };
  /** Contra as médias sem arredondar: (dia - média) / média. */
  variacao_faturamento_bps: number;
  variacao_faturamento_percentual: number;
  variacao_ticket_bps: number;
  variacao_ticket_percentual: number;
}

export interface EntradaDiaContraMesmosDias {
  data: string;
  /** Vendas por dia: a função consulta a data e os mesmos dias das semanas anteriores. */
  vendas: readonly VendasDoDia[];
  intervaloDeVendas: IntervaloDeDados | null;
}

/** Quantos dias antes da data o cálculo consulta. */
export const diasDeHistoricoDoDiaContraMesmosDias = (
  parametros: ParametrosDiaContraMesmosDias = PARAMETROS_DIA_CONTRA_MESMOS_DIAS,
): number => 7 * parametros.semanasAnteriores;

/**
 * O dia contra a média dos mesmos dias das semanas anteriores. Devolve dado ausente quando algum
 * desses dias não tem vendas importadas ou não teve venda: nunca compara com o que não existe.
 */
export function calcularDiaContraMesmosDias(
  entrada: EntradaDiaContraMesmosDias,
  parametros: ParametrosDiaContraMesmosDias = PARAMETROS_DIA_CONTRA_MESMOS_DIAS,
): ResultadoMetrica<DiaContraMesmosDias> | DadoAusente {
  const { data } = entrada;
  const vendasDe = indexarVendasPorDia(entrada.vendas, entrada.intervaloDeVendas);
  const datasAnteriores = Array.from({ length: parametros.semanasAnteriores }, (_, i) =>
    somarDias(data, -7 * (i + 1)),
  );

  const doDia = vendasDe(data);
  if (!doDia) {
    return dadoAusente(
      "dia_sem_dados",
      `Não há vendas importadas para ${data}.`,
      "Pode enviar a planilha de vendas mais recente?",
    );
  }
  if (doDia.cupons === 0) {
    return dadoAusente("sem_vendas_no_dia", `Não houve venda em ${data}.`);
  }
  const anteriores: VendasDoDia[] = [];
  for (const dataAnterior of datasAnteriores) {
    const dia = vendasDe(dataAnterior);
    if (!dia || dia.cupons === 0) {
      return dadoAusente(
        "historico_insuficiente",
        `Faltam vendas importadas em ${dataAnterior}, então não há média dos mesmos dias da semana para comparar.`,
      );
    }
    anteriores.push(dia);
  }

  const semanas = anteriores.length;
  const faturamentoAnterior = anteriores.reduce((soma, d) => soma + d.faturamentoCentavos, 0);
  const vendasAnteriores = anteriores.reduce((soma, d) => soma + d.cupons, 0);
  const ticket = dividirArredondando(doDia.faturamentoCentavos, doDia.cupons) ?? 0;
  const mediaTicket = dividirArredondando(faturamentoAnterior, vendasAnteriores) ?? 0;
  // As variações usam as médias exatas (somas inteiras), não as arredondadas para exibir.
  const variacaoFaturamento =
    razaoEmBps(semanas * doDia.faturamentoCentavos - faturamentoAnterior, faturamentoAnterior) ?? 0;
  const variacaoTicket =
    razaoEmBps(
      doDia.faturamentoCentavos * vendasAnteriores - faturamentoAnterior * doDia.cupons,
      faturamentoAnterior * doDia.cupons,
    ) ?? 0;

  return resultadoMetrica<DiaContraMesmosDias>(
    {
      data,
      dia_da_semana: diaDaSemana(data),
      dia: {
        faturamento_centavos: doDia.faturamentoCentavos,
        vendas: doDia.cupons,
        ticket_medio_centavos: ticket,
      },
      mesmos_dias_anteriores: {
        semanas,
        datas: datasAnteriores,
        media_faturamento_centavos: dividirArredondando(faturamentoAnterior, semanas) ?? 0,
        media_vendas: dividirArredondando(vendasAnteriores, semanas) ?? 0,
        media_ticket_medio_centavos: mediaTicket,
      },
      variacao_faturamento_bps: variacaoFaturamento,
      variacao_faturamento_percentual: percentualDeBps(variacaoFaturamento),
      variacao_ticket_bps: variacaoTicket,
      variacao_ticket_percentual: percentualDeBps(variacaoTicket),
    },
    { inicio: datasAnteriores.at(-1) ?? data, fim: data },
    [doDia, ...anteriores],
  );
}
