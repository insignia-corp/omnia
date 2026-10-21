import { dataLocal, relogioComDataFixa, relogioDoSistema } from "../../canal/relogio";
import type { Env } from "../../config/env";

/**
 * Data de hoje do job de reajuste: a mesma regra do relógio do canal (data fixa da demonstração),
 * inclusive a recusa em produção. Fica aqui para o AlertasModule não importar o CanalModule, que
 * importa a ingestão, que importa este módulo.
 */
export function criarHoje(
  env: Pick<Env, "NODE_ENV" | "DEMO_DATA_REFERENCIA" | "FUSO_HORARIO">,
): () => string {
  if (env.DEMO_DATA_REFERENCIA && env.NODE_ENV === "production") {
    throw new Error("DEMO_DATA_REFERENCIA não vale em produção");
  }
  const relogio = env.DEMO_DATA_REFERENCIA
    ? relogioComDataFixa(env.DEMO_DATA_REFERENCIA, env.FUSO_HORARIO)
    : relogioDoSistema;
  return () => dataLocal(relogio.agora(), env.FUSO_HORARIO);
}
