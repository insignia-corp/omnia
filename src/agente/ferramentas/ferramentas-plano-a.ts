import type { Ferramenta } from "./ferramenta";
import type { DependenciasFerramentas } from "./dependencias";
import { MetricasService } from "../../metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../../metricas/repositorio-metricas";
import { criarGetCostChanges } from "./plano-a/get-cost-changes";
import { criarGetDailySummary } from "./plano-a/get-daily-summary";
import { criarGetProductMargin } from "./plano-a/get-product-margin";
import { criarGetTopProducts } from "./plano-a/get-top-products";

/**
 * Ferramentas do plano A (dados e alertas). Arquivo só do plano A: os outros planos não editam aqui.
 * Cada ferramenta nova entra na lista devolvida, que o catálogo junta com as dos outros planos.
 * As de leitura embrulham o `MetricasService`, montado aqui com o mesmo `db` (o serviço é sem estado).
 */
export function ferramentasPlanoA({ db }: DependenciasFerramentas): Ferramenta[] {
  const metricas = new MetricasService(new RepositorioMetricasPostgres(db));
  return [
    criarGetDailySummary(metricas),
    criarGetTopProducts(metricas),
    criarGetProductMargin(metricas, db),
    criarGetCostChanges(metricas),
  ];
}
