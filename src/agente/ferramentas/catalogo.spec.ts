import type { Db } from "../../infra/database/database.module";
import { montarCatalogo } from "./catalogo";
import { RegistroFerramentas } from "./registro-ferramentas";

const dependencias = { db: {} as Db };

describe("montarCatalogo", () => {
  it("junta as listas dos três planos e o registro aceita o resultado", () => {
    const catalogo = montarCatalogo(dependencias);
    expect(() => new RegistroFerramentas(catalogo)).not.toThrow();
  });

  it("não repete nome de ferramenta entre planos", () => {
    const nomes = montarCatalogo(dependencias).map((f) => f.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
