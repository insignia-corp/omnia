import { Pool } from "pg";
import { lerArquivoEnv } from "../../config/arquivo-env";
import { carregarEnv } from "../../config/env";

/** Apaga todo o schema público. Só para desenvolvimento e testes. */
async function resetar(): Promise<void> {
  lerArquivoEnv();
  const env = carregarEnv();
  if (env.NODE_ENV === "production") throw new Error("db:reset não roda em produção.");
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
  } finally {
    await pool.end();
  }
}

resetar()
  .then(() => console.log("Banco zerado."))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
