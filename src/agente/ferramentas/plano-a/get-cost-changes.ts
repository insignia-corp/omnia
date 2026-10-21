import { z } from "zod";
import type { MetricasService } from "../../../metricas/metricas.service";
import type { VariacaoDeCusto } from "../../../metricas/variacao-de-custo";
import type { ResultadoMetrica } from "../../../metricas/resultado-metrica";
import { definirFerramenta } from "../ferramenta";

/**
 * Reajustes de custo por produto e fornecedor (issue #51). A métrica já ordena da maior alta para
 * a maior queda; a ferramenta só filtra pelas marcas que a métrica calcula.
 */
export function criarGetCostChanges(metricas: MetricasService) {
  return definirFerramenta({
    nome: "get_cost_changes",
    descricao:
      "Variação de custo entre as duas últimas compras de cada par produto e fornecedor, da maior alta " +
      "para a maior queda. Cada item traz custos, datas das compras, variação percentual, se passa do " +
      "limite de reajuste, se a compra atual é recente e a menor confiança das duas compras. " +
      "filtro 'acima_do_limite' mostra só os reajustes que passam do limite; 'recentes' só os de " +
      "compra atual recente; 'todos' (padrão) não filtra. Lista vazia significa que não há variação.",
    entrada: z.strictObject({
      filtro: z.enum(["todos", "acima_do_limite", "recentes"]).default("todos"),
    }),
    efeito: "nenhum",
    async executar(contexto, { filtro }): Promise<ResultadoMetrica<VariacaoDeCusto[]>> {
      const resultado = await metricas.variacoesDeCusto(contexto);
      if (filtro === "todos") return resultado;
      const mantem = (v: VariacaoDeCusto) => (filtro === "acima_do_limite" ? v.acima_do_limite : v.recente);
      return { ...resultado, valor: resultado.valor.filter(mantem) };
    },
  });
}
