import type { tipoAlerta } from "../infra/database/schema";

export type TipoAlerta = (typeof tipoAlerta.enumValues)[number];

/** 1 = mais importante, 3 = menos (coluna `alerta.prioridade`). */
export type Prioridade = 1 | 2 | 3;
