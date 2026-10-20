import { readFileSync } from "node:fs";
import path from "node:path";

export interface PromptExtrator {
  versao: string;
  texto: string;
}

/** Prompt versionado em arquivo. A versão é gravada em cada extração. */
export function carregarPromptExtrator(versao = "v1"): PromptExtrator {
  return {
    versao: `extrator-${versao}`,
    texto: readFileSync(path.join(__dirname, `prompt-extrator-${versao}.md`), "utf8"),
  };
}
