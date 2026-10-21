import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
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
import type { ClienteVisao, RespostaVisao } from "../../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";
import { ModeloFalso } from "./modelo-falso";

// O modelo devolve confiança alta mesmo quando erra: quem reduz é o código.
const comoDoModelo = (nota: string): RespostaVisao => {
  const e = JSON.parse(readFileSync(`fixtures/notas/${nota}.esperado.json`, "utf8"));
  e.confianca_documento = 1;
  for (const i of e.itens) i.confianca = 1;
  return {
    texto: JSON.stringify(e),
    recusou: false,
    consumo: { entrada: 2100, saida: 900, cacheLeitura: 0, cacheEscrita: 0 },
    modelo: "claude-sonnet-5-5",
  };
};

describe("demo ponta a ponta no chat web (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-demo-"));
  const modelo = new ModeloFalso();
  const visao: ClienteVisao = { extrair: () => Promise.resolve(comoDoModelo("nota-01")) };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dono = "";

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const [c] = await db
      .insert(schema.comerciante)
      .values({ nome: "E2E Demo" })
      .returning({ id: schema.comerciante.id });
    dono = c!.id;
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODELO_LINGUAGEM)
      .useValue(modelo)
      .overrideProvider(CLIENTE_VISAO)
      .useValue(visao)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, dono));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("nota entra, é extraída, o dono conversa e a mensagem sai registrada", async () => {
    const servidor = app.getHttpServer() as Parameters<typeof request>[0];
    const como = { "X-Comerciante-Id": dono };

    const envio = await request(servidor)
      .post("/chat/notas")
      .set(como)
      .attach("arquivo", readFileSync("fixtures/notas/nota-01.jpg"), {
        filename: "nota-01.jpg",
        contentType: "image/jpeg",
      })
      .expect(202);
    const documentoId = (envio.body as { documento_id: string }).documento_id;

    const limite = Date.now() + 15_000;
    let status = "pendente";
    while ((status === "pendente" || status === "processando") && Date.now() < limite) {
      status = (
        (await request(servidor).get(`/documentos/${documentoId}`).set(como)).body as { status: string }
      ).status;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(["extraido", "revisao"]).toContain(status);

    await request(servidor)
      .post("/chat/mensagens")
      .set(como)
      .send({ id_externo: randomUUID(), texto: "Como está o meu negócio?" })
      .expect(200);

    const lista = (await request(servidor).get("/chat/mensagens").set(como).expect(200)).body as Array<{
      direcao: string;
    }>;
    expect(lista.map((m) => m.direcao)).toEqual(["recebida", "enviada", "recebida", "enviada"]);

    const enviadas = await db.select().from(schema.mensagem).where(eq(schema.mensagem.comercianteId, dono));
    expect(enviadas.filter((m) => m.direcao === "enviada" && m.execucaoId)).toHaveLength(1);
    const execucoes = await db
      .select()
      .from(schema.execucaoAgente)
      .where(eq(schema.execucaoAgente.comercianteId, dono));
    expect(execucoes.map((e) => e.gatilho).sort()).toEqual(["extracao_nota", "mensagem_dono"]);
    expect(execucoes.every((e) => e.resultado === "aprovada")).toBe(true);
  });
});
