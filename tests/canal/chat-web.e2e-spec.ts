import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
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
import type { ClienteVisao } from "../../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";
import { ModeloFalso } from "../demo/modelo-falso";

interface MensagemApi {
  id: string;
  direcao: "enviada" | "recebida";
  texto: string;
}

describe("chat web (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-chat-"));
  const modelo = new ModeloFalso();
  // A extração roda em segundo plano; aqui só importa que a foto entra e o dono é avisado.
  const visao: ClienteVisao = { extrair: () => Promise.reject(new Error("fora do escopo deste teste")) };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let a = "";
  let b = "";

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const como = (id: string) => ({ "X-Comerciante-Id": id });

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Chat A" }, { nome: "E2E Chat B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;

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
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, [a, b]));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("serve a página do chat sem sessão", async () => {
    const r = await request(servidor()).get("/chat").expect(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    expect(r.text).toContain("Omnia");
  });

  it("recusa chamadas sem comerciante ou com comerciante desconhecido", async () => {
    await request(servidor()).get("/chat/mensagens").expect(401);
    await request(servidor()).get("/chat/mensagens").set(como(randomUUID())).expect(401);
  });

  it("recusa corpo inválido", async () => {
    await request(servidor())
      .post("/chat/mensagens")
      .set(como(a))
      .send({ id_externo: "nao-uuid", texto: "oi" })
      .expect(400);
    await request(servidor())
      .post("/chat/mensagens")
      .set(como(a))
      .send({ id_externo: randomUUID(), texto: "oi", comerciante_id: b })
      .expect(400);
  });

  it("responde com o agente e registra as duas mensagens", async () => {
    const id = randomUUID();
    const r = await request(servidor())
      .post("/chat/mensagens")
      .set(como(a))
      .send({ id_externo: id, texto: "Como está o dia?" })
      .expect(200);
    expect((r.body as MensagemApi).direcao).toBe("enviada");
    expect((r.body as MensagemApi).texto).toContain("Tudo certo");

    const lista = (await request(servidor()).get("/chat/mensagens").set(como(a)).expect(200))
      .body as MensagemApi[];
    expect(lista.map((m) => m.direcao)).toEqual(["recebida", "enviada"]);
    expect(lista[0]!.texto).toBe("Como está o dia?");

    const execucoes = await db
      .select()
      .from(schema.execucaoAgente)
      .where(eq(schema.execucaoAgente.comercianteId, a));
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]!.gatilho).toBe("mensagem_dono");
  });

  it("reentrega do mesmo id_externo não roda o agente de novo", async () => {
    const id = randomUUID();
    const antes = modelo.chamadas;
    const envia = () =>
      request(servidor()).post("/chat/mensagens").set(como(a)).send({ id_externo: id, texto: "De novo" });
    const primeira = (await envia().expect(200)).body as MensagemApi;
    const segunda = (await envia().expect(200)).body as MensagemApi;
    expect(segunda.id).toBe(primeira.id);
    expect(modelo.chamadas - antes).toBe(1);
  });

  it("um comerciante não vê as mensagens do outro", async () => {
    const lista = (await request(servidor()).get("/chat/mensagens").set(como(b)).expect(200))
      .body as MensagemApi[];
    expect(lista).toEqual([]);
  });

  it("recebe a foto da nota, cria o documento e avisa o dono", async () => {
    const foto = readFileSync("fixtures/notas/nota-01.jpg");
    const r = await request(servidor())
      .post("/chat/notas")
      .set(como(b))
      .attach("arquivo", foto, { filename: "nota-01.jpg", contentType: "image/jpeg" })
      .expect(202);
    const corpo = r.body as { documento_id: string; mensagem: MensagemApi };
    expect(corpo.documento_id).toBeTruthy();
    expect(corpo.mensagem.texto).toMatch(/Recebi a foto/);
    const docs = await db.select().from(schema.documento).where(eq(schema.documento.comercianteId, b));
    expect(docs).toHaveLength(1);
  });
});
