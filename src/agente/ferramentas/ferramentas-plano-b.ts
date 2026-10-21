import type { Ferramenta } from "./ferramenta";
import type { DependenciasFerramentas } from "./dependencias";

/**
 * Ferramentas do plano B (agente e avaliação). Arquivo só do plano B: os outros planos não editam aqui.
 * Cada ferramenta nova entra na lista devolvida, que o catálogo junta com as dos outros planos.
 */
export function ferramentasPlanoB(_dependencias: DependenciasFerramentas): Ferramenta[] {
  return [];
}
