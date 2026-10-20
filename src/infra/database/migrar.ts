import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";
import { lerArquivoEnv } from "../../config/arquivo-env";
import { carregarEnv } from "../../config/env";

const ERROS_DE_CONEXAO = new Set(["ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "ECONNRESET", "57P03"]);

/** Falha de rede ou banco ainda subindo (no Docker, o DNS interno pode demorar na primeira subida). */
function ehErroDeConexao(e: unknown): boolean {
  for (let atual: unknown = e; atual; atual = (atual as { cause?: unknown }).cause) {
    const codigo = (atual as { code?: unknown }).code;
    if (typeof codigo === "string" && ERROS_DE_CONEXAO.has(codigo)) return true;
  }
  return false;
}

/**
 * Aplica as migrações em ./drizzle. Usado por `npm run db:migrate` e na subida do contêiner.
 * Tenta de novo quando o banco ainda não está acessível.
 */
export async function migrar(databaseUrl: string, tentativas = 10, esperaMs = 2000): Promise<void> {
  for (let tentativa = 1; ; tentativa++) {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
      await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
      return;
    } catch (e) {
      if (!ehErroDeConexao(e) || tentativa >= tentativas) throw e;
      console.warn(`Banco indisponível (tentativa ${tentativa}/${tentativas}), tentando de novo...`);
      await new Promise((r) => setTimeout(r, esperaMs));
    } finally {
      await pool.end();
    }
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
