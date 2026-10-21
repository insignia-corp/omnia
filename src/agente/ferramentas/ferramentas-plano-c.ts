import type { Ferramenta } from "./ferramenta";
import type { DependenciasFerramentas } from "./dependencias";

/**
 * Ferramentas do plano C (canal, demo e ingestão). Arquivo só do plano C: os outros planos não editam aqui.
 * Cada ferramenta nova entra na lista devolvida, que o catálogo junta com as dos outros planos.
 */
export function ferramentasPlanoC(_dependencias: DependenciasFerramentas): Ferramenta[] {
  return [];
}
