import type { CasoAvaliacao } from "../tipos";
import { casosDeExemplo } from "./exemplos";

/**
 * Todos os casos da rodada. As issues #69 a #74 acrescentam os seus aqui, um arquivo por issue,
 * sem mexer no runner nem no relatório.
 */
export function todosOsCasos(): CasoAvaliacao[] {
  const casos = [...casosDeExemplo()];
  const repetido = casos.map((c) => c.id).find((id, i, ids) => ids.indexOf(id) !== i);
  if (repetido) throw new Error(`Caso repetido: ${repetido}`);
  return casos;
}
