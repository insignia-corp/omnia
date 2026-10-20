import type { Response } from "express";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { PRAZO_CHECAGEM_MS, SaudeController } from "./saude.controller";

describe("SaudeController", () => {
  const query = jest.fn();
  const release = jest.fn();
  const ping = jest.fn();
  const status = jest.fn();

  function criar(estadoRedis = "ready") {
    return new SaudeController(
      { connect: () => Promise.resolve({ query, release }) } as unknown as Pool,
      { ping, status: estadoRedis } as unknown as Redis,
    );
  }

  const resposta = { status } as unknown as Response;

  beforeEach(() => {
    jest.useFakeTimers();
    query.mockReset().mockResolvedValue({ rowCount: 1 });
    release.mockReset();
    ping.mockReset().mockResolvedValue("PONG");
    status.mockReset();
  });

  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  it("retorna ok e limpa os temporizadores quando tudo responde", async () => {
    expect(await criar().verificar(resposta)).toEqual({
      status: "ok",
      postgres: "ok",
      pgTrgm: "ok",
      redis: "ok",
    });
    expect(status).not.toHaveBeenCalled();
  });

  it.each(["connecting", "reconnecting", "close", "end"])(
    "retorna 503 sem enfileirar PING quando Redis está %s",
    async (estadoRedis) => {
      expect(await criar(estadoRedis).verificar(resposta)).toMatchObject({ status: "falha", redis: "falha" });
      expect(ping).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(503);
    },
  );

  it("retorna 503 dentro do prazo quando PING fica pendente", async () => {
    ping.mockReturnValue(new Promise<string>(() => {}));
    const pendente = criar().verificar(resposta);
    await jest.advanceTimersByTimeAsync(PRAZO_CHECAGEM_MS);
    expect(await pendente).toEqual({
      status: "falha",
      postgres: "ok",
      pgTrgm: "ok",
      redis: "falha",
    });
    expect(status).toHaveBeenCalledWith(503);
  });

  it("trata rejeição tardia do Redis depois de responder ao healthcheck", async () => {
    let rejeitar: (erro: Error) => void = () => {};
    ping.mockReturnValue(
      new Promise<string>((_, reject) => {
        rejeitar = reject;
      }),
    );
    const pendente = criar().verificar(resposta);
    await jest.advanceTimersByTimeAsync(PRAZO_CHECAGEM_MS);
    expect(await pendente).toMatchObject({ redis: "falha" });
    rejeitar(new Error("Redis caiu"));
    await Promise.resolve();
  });

  it.each(["erro", "resposta inválida"])("trata PING com %s", async (cenario) => {
    if (cenario === "erro") ping.mockRejectedValue(new Error("Redis caiu"));
    else ping.mockResolvedValue("INVALIDO");
    expect(await criar().verificar(resposta)).toMatchObject({ status: "falha", redis: "falha" });
    expect(status).toHaveBeenCalledWith(503);
  });

  it("limita também a espera pelo PostgreSQL", async () => {
    query.mockReturnValue(new Promise(() => {}));
    const pendente = criar().verificar(resposta);
    await jest.advanceTimersByTimeAsync(PRAZO_CHECAGEM_MS);
    expect(await pendente).toEqual({
      status: "falha",
      postgres: "falha",
      pgTrgm: "falha",
      redis: "ok",
    });
    expect(status).toHaveBeenCalledWith(503);
  });

  it("consulta numa transação com statement_timeout e devolve a conexão ao pool", async () => {
    await criar().verificar(resposta);
    expect(query).toHaveBeenCalledWith("BEGIN");
    expect(query).toHaveBeenCalledWith(`SET LOCAL statement_timeout = ${PRAZO_CHECAGEM_MS}`);
    expect(query).toHaveBeenCalledWith("COMMIT");
    expect(release).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith(false);
  });

  it("destrói a conexão quando a consulta falha, em vez de devolvê-la ao pool", async () => {
    query.mockImplementation((texto: string) =>
      texto === "SELECT 1" ? Promise.reject(new Error("banco caiu")) : Promise.resolve({ rowCount: 1 }),
    );
    expect(await criar().verificar(resposta)).toMatchObject({ postgres: "falha", pgTrgm: "ok" });
    expect(release).toHaveBeenCalledWith(true);
  });

  it("retorna falha quando pg_trgm está ausente", async () => {
    query.mockImplementation((texto: string) =>
      Promise.resolve({ rowCount: texto.includes("pg_extension") ? 0 : 1 }),
    );
    expect(await criar().verificar(resposta)).toMatchObject({
      status: "falha",
      postgres: "ok",
      pgTrgm: "falha",
    });
  });
});
