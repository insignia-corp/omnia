/**
 * Gasto fora do padrão (issue #39): desvio robusto do gasto operacional do dia contra os 60 dias
 * anteriores, (valor do dia - mediana) / desvio absoluto mediano. A mediana e o desvio absoluto
 * mediano aguentam um dia extremo no histórico, que enganaria a média e o desvio padrão.
 * Fórmula e limites em docs/guia-desenvolvimento.md, seção "Métricas determinísticas".
 *
 * A série é só de saídas das categorias operacionais: compras de mercadoria e despesas fixas
 * ficam fora, porque variam por natureza. Dia sem gasto dentro do período com dado vale zero.
 */
import { intervaloDeDatas, somarDias } from "../lib/datas/datas";
import type { IntervaloDeDados, MovimentoDoDia } from "./dados-de-metricas";
import { medianaEDesvioAbsolutoMediano } from "./estatistica";
import { dividirArredondando } from "./pontos-base";
import { dadoAusente, resultadoMetrica, type DadoAusente, type ResultadoMetrica } from "./resultado-metrica";

/** Valores iniciais, para ajustar com as entrevistas e os dados de teste. */
export const PARAMETROS_GASTO_FORA_DO_PADRAO = {
  janelaDias: 60,
  minimoDiasDeHistorico: 30,
  limiteDesvio: 3,
  /** Categorias do extrato que entram na série. */
  categorias: ["despesa_operacional"],
} as const;
export type ParametrosGastoForaDoPadrao = {
  readonly janelaDias: number;
  readonly minimoDiasDeHistorico: number;
  readonly limiteDesvio: number;
  readonly categorias: readonly string[];
};

export interface GastoForaDoPadrao {
  data: string;
  valor_centavos: number;
  /** Mediana do histórico em centavos inteiros: o meio centavo da mediana de um número par arredonda para cima. */
  mediana_centavos: number;
  /** Desvio absoluto mediano em centavos inteiros, arredondado para exibir. O `desvio` usa o valor exato. */
  desvio_absoluto_mediano_centavos: number;
  /** Quantos desvios absolutos medianos o dia está da mediana, com 2 casas. Nulo quando o desvio absoluto mediano é zero. */
  desvio: number | null;
  /** Quantos dias de histórico entraram (de 30 a 60). */
  dias_de_historico: number;
  /** O desvio passa do limite (3, no valor inicial). */
  acima_do_limite: boolean;
}

export interface EntradaGastoForaDoPadrao {
  data: string;
  /** Movimentos bancários da janela de histórico até a data. */
  movimentos: readonly MovimentoDoDia[];
  /** Datas entre as quais há extrato importado; fora delas não se sabe o gasto, e isso não é zero. */
  intervaloDeMovimentos: IntervaloDeDados | null;
}

const maisRecente = (a: string, b: string): string => (a > b ? a : b);

/**
 * Gasto operacional do dia contra o padrão dos dias anteriores. Devolve dado ausente quando não há
 * extrato para o dia ou quando o histórico tem menos dias que o mínimo: sem padrão não há desvio.
 */
export function calcularGastoForaDoPadrao(
  entrada: EntradaGastoForaDoPadrao,
  parametros: ParametrosGastoForaDoPadrao = PARAMETROS_GASTO_FORA_DO_PADRAO,
): ResultadoMetrica<GastoForaDoPadrao> | DadoAusente {
  const { data, intervaloDeMovimentos: intervalo } = entrada;
  if (!intervalo || data < intervalo.primeira || data > intervalo.ultima) {
    return dadoAusente("dia_sem_dados", `Não há extrato bancário importado para ${data}.`);
  }

  const inicioDoHistorico = maisRecente(intervalo.primeira, somarDias(data, -parametros.janelaDias));
  const diasDoHistorico = intervaloDeDatas(inicioDoHistorico, somarDias(data, -1));
  if (diasDoHistorico.length < parametros.minimoDiasDeHistorico) {
    return dadoAusente(
      "historico_insuficiente",
      `Há ${diasDoHistorico.length} dias de extrato antes de ${data} e o padrão precisa de ${parametros.minimoDiasDeHistorico}.`,
    );
  }

  const daSerie = entrada.movimentos.filter(
    (m) =>
      m.tipo === "saida" &&
      m.categoria !== null &&
      parametros.categorias.includes(m.categoria) &&
      m.data >= inicioDoHistorico &&
      m.data <= data,
  );
  const porDia = new Map<string, number>();
  for (const m of daSerie) porDia.set(m.data, (porDia.get(m.data) ?? 0) + m.totalCentavos);

  const historico = diasDoHistorico.map((dia) => porDia.get(dia) ?? 0);
  const { medianaEmMeios, desvioEmQuartos } = medianaEDesvioAbsolutoMediano(historico);
  const valor = porDia.get(data) ?? 0;

  // desvio = (valor - mediana) / desvio absoluto mediano, com a mediana em meios e o desvio em
  // quartos: 2 * (2 * valor - medianaEmMeios) / desvioEmQuartos. Em centésimos, para arredondar uma vez.
  const centesimos =
    desvioEmQuartos === 0 ? null : dividirArredondando(200 * (2 * valor - medianaEmMeios), desvioEmQuartos);
  const desvio = centesimos === null ? null : centesimos / 100;

  return resultadoMetrica<GastoForaDoPadrao>(
    {
      data,
      valor_centavos: valor,
      mediana_centavos: dividirArredondando(medianaEmMeios, 2) ?? 0,
      desvio_absoluto_mediano_centavos: dividirArredondando(desvioEmQuartos, 4) ?? 0,
      desvio,
      dias_de_historico: historico.length,
      acima_do_limite: desvio !== null && desvio > parametros.limiteDesvio,
    },
    { inicio: inicioDoHistorico, fim: data },
    daSerie,
  );
}
