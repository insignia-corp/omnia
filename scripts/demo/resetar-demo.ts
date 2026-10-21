import { rm } from "node:fs/promises";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import { Pool } from "pg";
import { lerArquivoEnv } from "../../src/config/arquivo-env";
import { carregarEnv, type Env } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { carregarFixtures } from "../../src/infra/database/seed/carregar-fixtures";
import { comerciantesDoSeed, semear, type ResumoSeed } from "../../src/infra/database/seed/semear";
import { montarSeed } from "../../src/infra/database/seed/montar-seed";
import { limparFilasDaDemo, type OpcoesLimpeza } from "./limpar-filas";

export interface ResumoReset {
  comerciantes: ResumoSeed[];
  jobsRemovidos: number;
}

/**
 * Leva a demo ao estado inicial em um comando, sem tocar em outros comerciantes (regra inviolável 10:
 * o histórico de quem não é da demo nunca é apagado). Idempotente: duas execuções seguidas dão o
 * mesmo estado. Aplica as migrações, limpa os jobs e os arquivos da demo e recarrega o seed. Pausa as
 * filas durante todo o reset; se um job da demo estiver em execução, espera ele terminar; se não
 * terminar a tempo, o reset falha antes de mexer no banco, nos arquivos e nos jobs pendentes, e as
 * filas voltam a andar.
 */
export async function resetarDemo(
  env: Env,
  redis: Redis,
  opcoesFilas: OpcoesLimpeza = {},
): Promise<ResumoReset> {
  const fix = carregarFixtures();
  const ids = comerciantesDoSeed(fix).map(
    ({ opcoes, dados }) => montarSeed(dados, opcoes).comerciante.id as string,
  );

  await migrar(env.DATABASE_URL);
  let comerciantes: ResumoSeed[] = [];
  const jobsRemovidos = await limparFilasDaDemo(redis, ids, opcoesFilas, async () => {
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 });
    try {
      comerciantes = await semear(drizzle(pool, { schema }), fix);
      for (const id of ids) await rm(join(env.ARMAZENAMENTO_DIR, id), { recursive: true, force: true });
    } finally {
      await pool.end();
    }
  });
  return { comerciantes, jobsRemovidos };
}

if (require.main === module) {
  lerArquivoEnv();
  const env = carregarEnv();
  if (env.NODE_ENV === "production") {
    console.error("demo:reset não roda em produção.");
    process.exit(1);
  }
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  resetarDemo(env, redis)
    .then(({ comerciantes, jobsRemovidos }) => {
      console.table(comerciantes);
      console.log(`Jobs da demo removidos das filas: ${jobsRemovidos}`);
      const demo = comerciantes[0];
      if (demo) {
        const base = `http://localhost:${env.PORT}`;
        console.log(`Demo pronta para ${demo.comerciante}`);
        console.log(`  Chat:       ${base}/chat?comerciante=${demo.comercianteId}`);
        console.log(`  Bastidores: ${base}/bastidores?comerciante=${demo.comercianteId}`);
      }
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => void redis.quit());
}
