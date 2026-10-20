import type { Response } from "express";
import type Redis from "ioredis";
import type { Pool } from "pg";
import { PRAZO_CHECAGEM_MS, SaudeController } from "./saude.controller";

describe("SaudeController", () => {
  const query = jest.fn();
  const ping = jest.fn();
  const status = jest.fn();

  function criar(estadoRedis = "ready") {
    return new SaudeController(
      { query } as unknown as Pool,
      { ping, status: estadoRedis } as unknown as Redis,
    );
  }

  const resposta = { status } as unknown as Response;

  beforeEach(() => {
    jest.useFakeTimers();
    query.mockReset().mockResolvedValue({ rowCount: 1 });
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

  it("retorna falha quando pg_trgm está ausente", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    expect(await criar().verificar(resposta)).toMatchObject({
      status: "falha",
      postgres: "ok",
      pgTrgm: "falha",
    });
  });
});
