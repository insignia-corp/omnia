import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type Redis from "ioredis";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import { REDIS } from "../src/infra/redis/redis.module";

describe("GET /health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    await migrar(carregarEnv().DATABASE_URL);
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
    // app.init() não espera a conexão assíncrona do Redis. Este cenário exige
    // dependências prontas; enquanto conecta, o healthcheck deve retornar 503.
    await app.get<Redis>(REDIS).ping();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("responde ok com PostgreSQL, pg_trgm e Redis no ar", async () => {
    const servidor = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(servidor).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", postgres: "ok", pgTrgm: "ok", redis: "ok" });
  });

  it("responde 503 sem esperar reconexão quando Redis está desconectado", async () => {
    const redis = app.get<Redis>(REDIS);
    const servidor = app.getHttpServer() as Parameters<typeof request>[0];
    redis.disconnect();
    try {
      const res = await request(servidor)
        .get("/health")
        .timeout({ response: 2000, deadline: 2500 })
        .expect(503);
      expect(res.body).toEqual({ status: "falha", postgres: "ok", pgTrgm: "ok", redis: "falha" });
    } finally {
      await redis.connect();
    }
  });
});
