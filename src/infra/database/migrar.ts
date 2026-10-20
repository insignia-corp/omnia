import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import { lerArquivoEnv } from "../../config/arquivo-env";
import { carregarEnv } from "../../config/env";

/** Aplica as migrações em ./drizzle. Usado por `npm run db:migrate` e na subida do contêiner. */
export async function migrar(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  lerArquivoEnv();
  migrar(carregarEnv().DATABASE_URL)
    .then(() => console.log("Migrações aplicadas."))
    .catch((e: unknown) => {
      console.error(e);
      process.exit(1);
    });
}
