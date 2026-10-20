import { carregarEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://omnia:omnia@localhost:5432/omnia",
  REDIS_URL: "redis://localhost:6379",
};

describe("carregarEnv", () => {
  it("aplica os valores padrão", () => {
    const env = carregarEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.LLM_MODELO).toBe("claude-opus-5-5");
    expect(env.LIMITE_CONFIANCA_ITEM).toBe(0.8);
    expect(env.CANAL).toBe("web");
  });

  it("aplica os padrões da ingestão", () => {
    const env = carregarEnv(base);
    expect(env.LIMITE_SIMILARIDADE).toBe(0.45);
    expect(env.EXTRATOR_MODELO).toBe("claude-sonnet-5-5");
    expect(env.ARMAZENAMENTO_DIR).toBe("./.dados/arquivos");
    expect(env.UPLOAD_MAX_BYTES).toBe(10_485_760);
  });

  it("trata variável vazia como não definida", () => {
    const env = carregarEnv({ ...base, ANTHROPIC_API_KEY: "", LLM_MODELO: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.LLM_MODELO).toBe("claude-opus-5-5");
  });

  it("falha com mensagem clara quando falta variável obrigatória", () => {
    expect(() => carregarEnv({ REDIS_URL: base.REDIS_URL })).toThrow(/DATABASE_URL/);
  });

  it("rejeita URL de banco com protocolo errado", () => {
    expect(() => carregarEnv({ ...base, DATABASE_URL: "mysql://x@localhost/db" })).toThrow(/DATABASE_URL/);
  });
});
