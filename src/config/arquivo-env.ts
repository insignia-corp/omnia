import { existsSync } from "node:fs";

/** Lê o .env local, se existir. Variáveis já definidas no ambiente (Docker, CI) têm prioridade. */
export function lerArquivoEnv(caminho = ".env"): void {
  if (existsSync(caminho)) process.loadEnvFile(caminho);
}
