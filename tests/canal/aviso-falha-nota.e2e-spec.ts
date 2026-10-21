import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { MODELO_LINGUAGEM } from "../../src/agente/llm/modelo-linguagem";
import { ConversaService, TEXTO_FALHA_NOTA } from "../../src/canal/conversa.service";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import type { ClienteVisao } from "../../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";
import { ModeloFalso } from "../demo/modelo-falso";

interface MensagemApi {
  direcao: "enviada" | "recebida";
  texto: string;
}

describe("aviso ao dono quando a leitura da nota falha (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-falha-"));
  // O modelo recusa a imagem: falha de vez já na primeira tentativa, sem esperar o backoff.
  const visao: ClienteVisao = {
    extrair: () =>
      Promise.resolve({
        texto: "",
        recusou: true,
        consumo: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
        modelo: "claude-sonnet-5-5",
      }),
  };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let conversa: ConversaService;
  let a = "";
  let b = "";
  let c = "";

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const como = (id: string) => ({ "X-Comerciante-Id": id });
  const mensagensDe = (id: string) =>
    db.select().from(schema.mensagem).where(eq(schema.mensagem.comercianteId, id));

  async function aguardarFalha(documentoId: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const [d] = await db
        .select({ status: schema.documento.statusExtracao })
        .from(schema.documento)
        .where(eq(schema.documento.id, documentoId));
      if (d?.status === "falha") return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error("o documento não chegou a falha");
  }

  async function aguardarMensagem(id: string, chave: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const linhas = await mensagensDe(id);
      if (linhas.some((m) => m.chaveIdempotencia === chave)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`a mensagem ${chave} não saiu`);
  }

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Falha A" }, { nome: "E2E Falha B" }, { nome: "E2E Falha C" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;
    c = criados[2]!.id;

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODELO_LINGUAGEM)
      .useValue(new ModeloFalso())
      .overrideProvider(CLIENTE_VISAO)
      .useValue(visao)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
    conversa = app.get(ConversaService);
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, [a, b, c]));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("nota enviada pelo chat que falha de vez gera uma resposta fixa, sem número", async () => {
    const foto = readFileSync("fixtures/notas/nota-01.jpg");
    const r = await request(servidor())
      .post("/chat/notas")
      .set(como(a))
      .attach("arquivo", foto, { filename: "nota-01.jpg", contentType: "image/jpeg" })
      .expect(202);
    const documentoId = (r.body as { documento_id: string }).documento_id;
    await aguardarFalha(documentoId);
    const chave = `nota_falha_${documentoId}`;
    await aguardarMensagem(a, chave);

    const avisos = (await mensagensDe(a)).filter((m) => m.chaveIdempotencia === chave);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.direcao).toBe("enviada");
    expect(avisos[0]!.proativa).toBe(false);
    expect(avisos[0]!.texto).toBe(TEXTO_FALHA_NOTA);
    expect(avisos[0]!.texto).not.toMatch(/\d/);
    expect(avisos[0]!.texto).not.toContain("\u2014");

    const lista = (await request(servidor()).get("/chat/mensagens").set(como(a)).expect(200))
      .body as MensagemApi[];
    expect(lista.map((m) => m.direcao)).toEqual(["recebida", "enviada", "enviada"]);

    // Idempotente: chamar de novo não cria outra mensagem.
    await conversa.avisarFalhaExtracao(a, documentoId);
    await conversa.avisarFalhaExtracao(a, documentoId);
    expect((await mensagensDe(a)).filter((m) => m.chaveIdempotencia === chave)).toHaveLength(1);
  });

  it("nota enviada por POST /documentos/notas não gera mensagem: não há conversa a responder", async () => {
    const foto = readFileSync("fixtures/notas/nota-02.jpg");
    const r = await request(servidor())
      .post("/documentos/notas")
      .set(como(b))
      .attach("arquivo", foto, { filename: "nota-02.jpg", contentType: "image/jpeg" })
      .expect(202);
    await aguardarFalha((r.body as { documento_id: string }).documento_id);
    await new Promise((res) => setTimeout(res, 500));
    expect(await mensagensDe(b)).toHaveLength(0);
  });

  it("falha anterior ao aviso de recebimento: quem avisa é o próprio aviso de recebimento", async () => {
    const [doc] = await db
      .insert(schema.documento)
      .values({
        comercianteId: c,
        tipo: "foto_nota",
        arquivoCaminho: `${c}/falha-corrida.jpg`,
        arquivoHash: `hash-falha-corrida-${c}`,
        statusExtracao: "falha",
      })
      .returning({ id: schema.documento.id });
    await conversa.avisarNotaRecebida(c, doc!.id);

    const linhas = await mensagensDe(c);
    expect(linhas.map((m) => m.texto)).toEqual([
      "Foto de nota enviada",
      expect.stringContaining("Recebi a foto"),
      TEXTO_FALHA_NOTA,
    ]);
    expect(linhas.some((m) => m.proativa)).toBe(false);
  });
});
