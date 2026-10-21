import type { AgenteService } from "../agente/agente.service";

export const PORTA_AGENTE = Symbol("PORTA_AGENTE");

/** Só o que o canal usa do agente: se o plano B mudar o resto, o canal não percebe. */
export type PortaAgente = Pick<AgenteService, "executar">;
