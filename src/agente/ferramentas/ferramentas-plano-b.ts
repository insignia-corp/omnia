import type { Ferramenta } from "./ferramenta";
import type { DependenciasFerramentas } from "./dependencias";
import { criarAskOwner } from "./ask-owner";
import { criarSaveOwnerAnswer } from "./save-owner-answer";
import { criarSelectAlerts } from "./select-alerts";

/**
 * Ferramentas do plano B (agente e avaliação). Arquivo só do plano B: os outros planos não editam aqui.
 * Cada ferramenta nova entra na lista devolvida, que o catálogo junta com as dos outros planos.
 */
export function ferramentasPlanoB({ db }: DependenciasFerramentas): Ferramenta[] {
  return [criarAskOwner(db), criarSaveOwnerAnswer(db), criarSelectAlerts(db)];
}
