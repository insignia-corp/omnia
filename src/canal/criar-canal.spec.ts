import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { criarCanal } from "./criar-canal";

describe("criarCanal", () => {
  it("devolve o chat web para CANAL=web", () => {
    expect(criarCanal({ CANAL: "web" }).nome).toBe("web");
  });

  it("falha com mensagem clara para CANAL=whatsapp enquanto não existe", () => {
    expect(() => criarCanal({ CANAL: "whatsapp" })).toThrow(/não implementado/);
  });
});

describe("independência do agente em relação ao canal (#106)", () => {
  const dirAgente = join(__dirname, "..", "agente");
  const arquivos = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? arquivos(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
    );

  it("nenhum arquivo de src/agente importa implementação de canal, só o contrato", () => {
    for (const arquivo of arquivos(dirAgente)) {
      const imports = readFileSync(arquivo, "utf8").match(/from\s+"[^"]*canal[^"]*"/g) ?? [];
      for (const i of imports) expect(i).toMatch(/message-channel"$/);
    }
  });
});
