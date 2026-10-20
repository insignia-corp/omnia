import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";

describe("GET /health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    await migrar(carregarEnv().DATABASE_URL);
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("responde ok com PostgreSQL, pg_trgm e Redis no ar", async () => {
    const servidor = app.getHttpServer() as Parameters<typeof request>[0];
    const res = await request(servidor).get("/health").expect(200);
    expect(res.body).toEqual({ status: "ok", postgres: "ok", pgTrgm: "ok", redis: "ok" });
  });
});
