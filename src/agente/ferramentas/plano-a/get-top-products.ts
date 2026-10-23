import { z } from "zod";
import { somarDias } from "../../../lib/datas/datas";
import type { MetricasService } from "../../../metricas/metricas.service";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import type { GiroDoProduto } from "../../../metricas/giro";
import type { ReceitaDoProduto } from "../../../metricas/receita-por-produto";
import { definirFerramenta } from "../ferramenta";

export type RankingDeProdutos =
  | { criterio: "volume" | "alta"; produtos: GiroDoProduto[] }
  | { criterio: "receita"; produtos: ReceitaDoProduto[] };

/**
 * Ranking de produtos (issues #50 e #148). Os rankings são os das métricas: o giro (últimos 7 dias
 * contra a média semanal dos 28 anteriores) para `volume` e `alta`, e a receita dos últimos 7 dias
 * para `receita`; a ferramenta só escolhe qual devolver, com a procedência da métrica. As janelas
 * terminam ontem, o último dia com vendas completas: a data de referência ainda não as tem.
 */
export function criarGetTopProducts(metricas: MetricasService) {
  return definirFerramenta({
    nome: "get_top_products",
    descricao:
      "Ranking dos produtos que mais vendem nos últimos 7 dias até ontem (o dia de hoje ainda não conta). criterio 'volume' lista os mais vendidos " +
      "em unidades; 'alta' lista os de maior alta sobre a média semanal dos 28 dias anteriores (só " +
      "produtos com volume mínimo); 'receita' lista os de maior faturamento em centavos. Volume e alta " +
      "trazem unidades, média semanal e alta percentual; receita traz receita_centavos. Pode vir como " +
      "dado ausente (ausente: true) quando as vendas importadas não cobrem o período: diga isso ao dono.",
    entrada: z.strictObject({
      criterio: z
        .enum(["volume", "alta", "receita"])
        .default("volume")
        .describe(
          "volume: mais unidades vendidas. alta: maior crescimento do giro. receita: maior faturamento.",
        ),
    }),
    efeito: "nenhum",
    async executar(
      contextoDaSessao,
      { criterio },
    ): Promise<ResultadoMetrica<RankingDeProdutos> | DadoAusente> {
      const contexto = {
        ...contextoDaSessao,
        dataReferencia: somarDias(contextoDaSessao.dataReferencia, -1),
      };
      if (criterio === "receita") {
        const receita = await metricas.receitaPorProduto(contexto);
        if (ehDadoAusente(receita)) return receita;
        const { valor, ...procedencia } = receita;
        return { ...procedencia, valor: { criterio, produtos: valor.maior_receita } };
      }
      const giro = await metricas.giro(contexto);
      if (ehDadoAusente(giro)) return giro;
      const { valor, ...procedencia } = giro;
      const produtos = criterio === "volume" ? valor.maior_volume : valor.maior_alta;
      return { ...procedencia, valor: { criterio, produtos } };
    },
  });
}
