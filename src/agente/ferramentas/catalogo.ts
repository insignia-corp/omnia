import type { Ferramenta } from "./ferramenta";
import type { DependenciasFerramentas } from "./dependencias";
import { ferramentasPlanoA } from "./ferramentas-plano-a";
import { ferramentasPlanoB } from "./ferramentas-plano-b";
import { ferramentasPlanoC } from "./ferramentas-plano-c";

/**
 * Catálogo único de ferramentas do agente: junta as listas dos três planos de desenvolvimento
 * (docs/protocolos/divisao-planos.md). O `RegistroFerramentas` recusa nome duplicado e
 * `comerciante_id` no esquema de entrada, então um erro de um plano aparece na subida.
 */
export function montarCatalogo(dependencias: DependenciasFerramentas): Ferramenta[] {
  return [
    ...ferramentasPlanoA(dependencias),
    ...ferramentasPlanoB(dependencias),
    ...ferramentasPlanoC(dependencias),
  ];
}
