import type { Db } from "../../infra/database/database.module";

/**
 * O que as ferramentas recebem para serem construídas. Dono: plano B. Quem precisar de mais
 * uma dependência (ex.: o canal) acrescenta o campo aqui num PR pequeno, sem tocar nos
 * arquivos dos outros planos.
 */
export interface DependenciasFerramentas {
  readonly db: Db;
}
