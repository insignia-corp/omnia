import type { Ferramenta } from "./ferramenta";
import type { DependenciasFerramentas } from "./dependencias";

/**
 * Ferramentas do plano A (dados e alertas). Arquivo só do plano A: os outros planos não editam aqui.
 * Cada ferramenta nova entra na lista devolvida, que o catálogo junta com as dos outros planos.
 */
export function ferramentasPlanoA(_dependencias: DependenciasFerramentas): Ferramenta[] {
  return [];
}
