import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Queue } from "bullmq";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { MODELO_LINGUAGEM } from "../../src/agente/llm/modelo-linguagem";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import type { ClienteVisao } from "../../src/ingestao/extracao/cliente-visao";
import { FILA_EXTRACAO, type JobExtracao } from "../../src/ingestao/fila/fila-extracao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";
import { ModeloFalso } from "../demo/modelo-falso";

describe("id de correlação da requisição ao job (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-correlacao-"));
  // O job só precisa existir na fila; a leitura da nota não importa aqui.
  const visao: ClienteVisao = { extrair: () => Promise.reject(new Error("fora do escopo deste teste")) };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let redis: Redis;
  let fila: Queue<JobExtracao>;
  let a = "";
  let b = "";

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];

  async function enviarNota(dono: string, arquivo: string, requestId: string): Promise<string> {
    const r = await request(servidor())
      .post("/chat/notas")
      .set({ "X-Comerciante-Id": dono, "X-Request-Id": requestId })
      .attach("arquivo", readFileSync(`fixtures/notas/${arquivo}`), {
        filename: arquivo,
        contentType: "image/jpeg",
      })
      .expect(202);
    return (r.body as { documento_id: string }).documento_id;
  }

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Correlação A" }, { nome: "E2E Correlação B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    fila = new Queue<JobExtracao>(FILA_EXTRACAO, { connection: redis });

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODELO_LINGUAGEM)
      .useValue(new ModeloFalso())
      .overrideProvider(CLIENTE_VISAO)
      .useValue(visao)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await fila?.close();
    redis?.disconnect();
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, [a, b]));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("o job leva o X-Request-Id da requisição que o enfileirou", async () => {
    const documentoId = await enviarNota(a, "nota-01.jpg", "e2e-correlacao-1");
    const job = await fila.getJob(`${a}_${documentoId}`);
    expect(job?.data.idCorrelacao).toBe("e2e-correlacao-1");
  });

  it("X-Request-Id inválido vira um id novo, que também vai no job", async () => {
    const documentoId = await enviarNota(b, "nota-02.jpg", "x".repeat(200));
    const job = await fila.getJob(`${b}_${documentoId}`);
    expect(job?.data.idCorrelacao).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
