/**
 * Resumo diário do pitch (ferramenta `get_daily_briefing`): o dia contra os mesmos dias da semana,
 * os mais vendidos e os piores da semana e os produtos que precisam de atenção, num só resultado.
 * Cada bloco vem da sua métrica; aqui só se monta a saída e se junta a procedência. Bloco sem dado
 * vem como dado ausente no lugar do valor, nunca como zero.
 */
import { compararTexto } from "./dados-de-metricas";
import type { ProdutoEmAtencao } from "./atencao";
import {
  diaDaSemana,
  type DiaContraMesmosDias,
  type DiaDaSemana,
  type NumerosDoDia,
} from "./dia-contra-mesmos-dias";
import {
  DIAS_DA_JANELA_DE_PRODUTOS,
  type ProdutoEmQueda,
  type ProdutoMaisVendido,
} from "./movimento-de-produtos";
import {
  combinarProcedencias,
  ehDadoAusente,
  procedenciaDe,
  type DadoAusente,
  type OrigemDado,
  type Periodo,
  type ResultadoMetrica,
} from "./resultado-metrica";

export interface BriefingDiario {
  data: string;
  dia_da_semana: DiaDaSemana;
  dia: NumerosDoDia | DadoAusente;
  mesmos_dias_anteriores: DiaContraMesmosDias["mesmos_dias_anteriores"] | DadoAusente;
  /** Nulas quando o dia ou os mesmos dias anteriores vêm como dado ausente. */
  variacao_faturamento_percentual: number | null;
  variacao_ticket_percentual: number | null;
  /** Dias da janela dos mais vendidos e dos piores: o número de "nos últimos 7 dias", para o verificador aceitar. */
  dias_da_janela_produtos: number;
  mais_vendidos: ProdutoMaisVendido[] | DadoAusente;
  piores: Omit<ProdutoEmQueda, "variacao_bps">[] | DadoAusente;
  atencao: ProdutoEmAtencao[];
  periodo: Periodo;
  n_registros: number;
  menor_confianca: number | null;
  origens: OrigemDado[];
}

export interface EntradaBriefingDiario {
  data: string;
  diaContraMesmosDias: ResultadoMetrica<DiaContraMesmosDias> | DadoAusente;
  maisVendidos: ResultadoMetrica<ProdutoMaisVendido[]> | DadoAusente;
  piores: ResultadoMetrica<ProdutoEmQueda[]> | DadoAusente;
  atencao: ResultadoMetrica<ProdutoEmAtencao[]>;
}

/** Monta o resumo diário a partir dos blocos já calculados, com a procedência de todos. */
export function montarBriefingDiario(entrada: EntradaBriefingDiario): BriefingDiario {
  const { data, diaContraMesmosDias: comparacao, maisVendidos, piores, atencao } = entrada;
  const calculados = [comparacao, maisVendidos, piores, atencao].flatMap((r) =>
    ehDadoAusente(r) ? [] : [r as ResultadoMetrica<unknown>],
  );

  // Quando falta o dia ou algum dos mesmos dias anteriores, `dia` e `mesmos_dias_anteriores` trazem o
  // mesmo dado ausente, que diz qual data falta.
  const inicio = calculados.map((r) => r.periodo.inicio).sort(compararTexto)[0] ?? data;
  return {
    data,
    dia_da_semana: diaDaSemana(data),
    dia: ehDadoAusente(comparacao) ? comparacao : comparacao.valor.dia,
    mesmos_dias_anteriores: ehDadoAusente(comparacao) ? comparacao : comparacao.valor.mesmos_dias_anteriores,
    variacao_faturamento_percentual: ehDadoAusente(comparacao)
      ? null
      : comparacao.valor.variacao_faturamento_percentual,
    variacao_ticket_percentual: ehDadoAusente(comparacao)
      ? null
      : comparacao.valor.variacao_ticket_percentual,
    dias_da_janela_produtos: DIAS_DA_JANELA_DE_PRODUTOS,
    mais_vendidos: ehDadoAusente(maisVendidos) ? maisVendidos : maisVendidos.valor,
    piores: ehDadoAusente(piores) ? piores : piores.valor.map(({ variacao_bps: _, ...resto }) => resto),
    atencao: atencao.valor,
    periodo: { inicio, fim: data },
    ...combinarProcedencias(calculados.map(procedenciaDe)),
  };
}
