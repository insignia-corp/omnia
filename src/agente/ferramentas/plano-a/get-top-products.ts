import { z } from "zod";
import type { MetricasService } from "../../../metricas/metricas.service";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import type { GiroDoProduto } from "../../../metricas/giro";
import { definirFerramenta } from "../ferramenta";

export interface RankingDeProdutos {
  criterio: "volume" | "alta";
  produtos: GiroDoProduto[];
}

/**
 * Ranking de produtos pelo giro (issue #50). Os rankings são os da métrica de giro (últimos 7 dias
 * contra a média semanal dos 28 anteriores); a ferramenta só escolhe qual devolver. O ranking por
 * receita não existe como métrica: quando existir, entra aqui como novo critério.
 */
export function criarGetTopProducts(metricas: MetricasService) {
  return definirFerramenta({
    nome: "get_top_products",
    descricao:
      "Ranking dos produtos que mais giram: últimos 7 dias contra a média semanal dos 28 dias anteriores. " +
      "criterio 'volume' lista os mais vendidos em unidades nos últimos 7 dias; 'alta' lista os de maior " +
      "alta sobre a média anterior (só produtos com volume mínimo). Cada produto traz unidades, média " +
      "semanal e alta percentual. Pode vir como dado ausente (ausente: true) quando não há vendas " +
      "suficientes para as duas janelas. Não há ranking por receita.",
    entrada: z.strictObject({
      criterio: z
        .enum(["volume", "alta"])
        .default("volume")
        .describe("volume: mais unidades vendidas. alta: maior crescimento do giro."),
    }),
    efeito: "nenhum",
    async executar(contexto, { criterio }): Promise<ResultadoMetrica<RankingDeProdutos> | DadoAusente> {
      const giro = await metricas.giro(contexto);
      if (ehDadoAusente(giro)) return giro;
      const { valor, ...procedencia } = giro;
      const produtos = criterio === "volume" ? valor.maior_volume : valor.maior_alta;
      return { ...procedencia, valor: { criterio, produtos } };
    },
  });
}
