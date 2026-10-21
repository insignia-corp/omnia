import { readFileSync } from "node:fs";
import path from "node:path";

export interface PromptVinculo {
  versao: string;
  texto: string;
}

/** Prompt versionado em arquivo. A versão é gravada em cada execução. */
export function carregarPromptVinculo(versao = "v1"): PromptVinculo {
  return {
    versao: `vinculo-${versao}`,
    texto: readFileSync(path.join(__dirname, `prompt-vinculo-${versao}.md`), "utf8"),
  };
}
