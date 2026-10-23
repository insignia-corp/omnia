import { readFileSync } from "node:fs";
import path from "node:path";

export interface PromptSistema {
  versao: string;
  renderizar(variaveis: { nomeComercio: string }): string;
}

/** Prompt versionado em arquivo. A versão é gravada em cada execução do agente. */
export function carregarPromptSistema(versao = "v4"): PromptSistema {
  const modelo = readFileSync(path.join(__dirname, `sistema-${versao}.md`), "utf8");
  return {
    versao: `sistema-${versao}`,
    renderizar: ({ nomeComercio }) => modelo.replaceAll("{{nome_do_comercio}}", nomeComercio),
  };
}
