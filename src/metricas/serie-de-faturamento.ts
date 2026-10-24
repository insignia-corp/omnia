/**
 * Faturamento dia a dia da semana ou do mês (issue #207), para os gráficos do painel do dono. Os
 * dias são os mesmos do resumo do período (`periodosDoResumo`), então as barras somam o total do
 * cartão quando o período está coberto.
 *
 * Dia sem dado não vira zero: fora do intervalo de vendas importadas o faturamento é nulo (a página
 * desenha uma lacuna). Dentro dele, dia sem cupom é dia sem venda e vale zero, como no resumo.
 */
import { intervaloDeDatas } from "../lib/datas/datas";
import { indexarVendasPorDia, type IntervaloDeDados, type VendasDoDia } from "./dados-de-metricas";
import { resultadoMetrica, type Procedencia, type ResultadoMetrica } from "./resultado-metrica";
import { periodosDoResumo, type TipoPeriodo } from "./resumo-de-periodo";

export interface FaturamentoDoDia {
  data: string;
  /** Nulo quando o dia está fora das vendas importadas: não se sabe, e isso não é zero. */
  faturamento_centavos: number | null;
}

export interface EntradaSerieDeFaturamento {
  tipo: TipoPeriodo;
  /** Último dia do período (AAAA-MM-DD), inclusive. */
  ate: string;
  vendas: readonly VendasDoDia[];
  intervaloDeVendas: IntervaloDeDados | null;
}

export function calcularSerieDeFaturamento(
  entrada: EntradaSerieDeFaturamento,
): ResultadoMetrica<FaturamentoDoDia[]> {
  const { atual } = periodosDoResumo(entrada.tipo, entrada.ate);
  const vendasDe = indexarVendasPorDia(entrada.vendas, entrada.intervaloDeVendas);
  const fontes: Procedencia[] = [];
  const dias = intervaloDeDatas(atual.inicio, atual.fim).map((data) => {
    const v = vendasDe(data);
    if (v) fontes.push(v);
    return { data, faturamento_centavos: v ? v.faturamentoCentavos : null };
  });
  return resultadoMetrica(dias, atual, fontes);
}
