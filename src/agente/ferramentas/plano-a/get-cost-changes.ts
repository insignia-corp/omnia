import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../../infra/database/database.module";
import { fornecedor } from "../../../infra/database/schema";
import type { MetricasService } from "../../../metricas/metricas.service";
import type { VariacaoDeCusto } from "../../../metricas/variacao-de-custo";
import { dadoAusente, type DadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import { definirFerramenta } from "../ferramenta";

/**
 * Reajustes de custo por produto e fornecedor (issue #51). A métrica já ordena da maior alta para
 * a maior queda; a ferramenta só filtra pelas marcas que a métrica calcula.
 */
/** A variação da métrica, com o nome do fornecedor do cadastro do comerciante da sessão. */
export type VariacaoDeCustoComFornecedor = VariacaoDeCusto & { fornecedor_nome: string | null };

export function criarGetCostChanges(metricas: MetricasService, db: Db) {
  return definirFerramenta({
    nome: "get_cost_changes",
    descricao:
      "Variação de custo entre as duas últimas compras de cada par produto e fornecedor, da maior alta " +
      "para a maior queda. Cada item traz custos, datas das compras, variação percentual, se passa do " +
      "limite de reajuste, se a compra atual é recente, a menor confiança das duas compras e o nome do fornecedor (fornecedor_nome). " +
      "filtro 'acima_do_limite' mostra só os reajustes que passam do limite; 'recentes' só os de " +
      "compra atual recente; 'todos' (padrão) não filtra. Sem nenhuma variação calculável devolve dado ausente " +
      "(ausente: true): isso não prova que o custo ficou igual, pode faltar histórico de compras. " +
      "Com filtro, lista vazia significa que existem variações, mas nenhuma passa pelo filtro.",
    entrada: z.strictObject({
      filtro: z.enum(["todos", "acima_do_limite", "recentes"]).default("todos"),
    }),
    efeito: "nenhum",
    async executar(
      contexto,
      { filtro },
    ): Promise<ResultadoMetrica<VariacaoDeCustoComFornecedor[]> | DadoAusente> {
      const resultado = await metricas.variacoesDeCusto(contexto);
      // Lista vazia da métrica não é "sem variação": também é sem compra, uma só compra por produto e
      // fornecedor, custo igual ou custo anterior zero. Sem evidência, o agente não afirma que nada mudou.
      if (resultado.valor.length === 0) {
        return dadoAusente(
          "sem_variacao_calculavel",
          "Não há variação de custo para informar: faltam duas compras do mesmo produto e fornecedor com custo diferente. " +
            "Isso não prova que o custo ficou igual.",
        );
      }
      const mantem = (v: VariacaoDeCusto) =>
        filtro === "todos" || (filtro === "acima_do_limite" ? v.acima_do_limite : v.recente);
      const variacoes = resultado.valor.filter(mantem);

      // Só fornecedores do comerciante da sessão: um id que não é dele fica sem nome, nunca com o de outro.
      const ids = [...new Set(variacoes.map((v) => v.fornecedor_id))];
      const nomes = new Map(
        ids.length === 0
          ? []
          : (
              await db
                .select({ id: fornecedor.id, nome: fornecedor.nome })
                .from(fornecedor)
                .where(and(eq(fornecedor.comercianteId, contexto.comercianteId), inArray(fornecedor.id, ids)))
            ).map((f) => [f.id, f.nome]),
      );
      return {
        ...resultado,
        valor: variacoes.map((v) => ({ ...v, fornecedor_nome: nomes.get(v.fornecedor_id) ?? null })),
      };
    },
  });
}
