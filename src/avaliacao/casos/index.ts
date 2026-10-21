import type { CasoAvaliacao } from "../tipos";
import { casosDeInjecao } from "./injecao";
import { casosNumericos } from "./numericas";
import { casosSemResposta } from "./sem-resposta";
import { casosDoVerificador } from "./verificador";

/**
 * Todos os casos da rodada, um arquivo por tema. As issues #71 e #74 acrescentam os seus aqui,
 * sem mexer no runner nem no relatório.
 */
export function todosOsCasos(): CasoAvaliacao[] {
  const casos = [...casosNumericos(), ...casosDoVerificador(), ...casosSemResposta(), ...casosDeInjecao()];
  const repetido = casos.map((c) => c.id).find((id, i, ids) => ids.indexOf(id) !== i);
  if (repetido) throw new Error(`Caso repetido: ${repetido}`);
  return casos;
}
