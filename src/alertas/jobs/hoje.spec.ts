import type { Env } from "../../config/env";
import { criarHoje } from "./hoje";

const env = (extra: Partial<Env>): Pick<Env, "NODE_ENV" | "DEMO_DATA_REFERENCIA" | "FUSO_HORARIO"> => ({
  NODE_ENV: "development",
  DEMO_DATA_REFERENCIA: undefined,
  FUSO_HORARIO: "America/Sao_Paulo",
  ...extra,
});

describe("criarHoje", () => {
  it("sem data de demonstração, usa a data local do relógio do sistema", () => {
    expect(criarHoje(env({}))()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("com DEMO_DATA_REFERENCIA, usa a data fixa da demonstração", () => {
    expect(criarHoje(env({ DEMO_DATA_REFERENCIA: "2026-10-19" }))()).toBe("2026-10-19");
  });

  it("DEMO_DATA_REFERENCIA em produção é recusada, como no canal", () => {
    expect(() => criarHoje(env({ NODE_ENV: "production", DEMO_DATA_REFERENCIA: "2026-10-19" }))).toThrow(
      /DEMO_DATA_REFERENCIA/,
    );
  });
});
