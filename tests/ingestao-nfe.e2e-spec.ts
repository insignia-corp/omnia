import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import type { ClienteVisao } from "../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../src/ingestao/ingestao.module";

interface Produto {
  id: string;
  nome: string;
  codigo_barras: string;
  unidade: string;
  categoria: string;
}
interface Envio {
  documento_id: string;
  status: string;
  duplicado: boolean;
}
interface Documento {
  tipo: string;
  status: string;
  motivos: Array<{ codigo: string }>;
  compra: null | {
    data: string;
    fornecedor: { nome: string; cnpj: string };
    total_centavos: number;
    soma_itens_centavos: number;
    itens: Array<{
      descricao: string;
      quantidade: number;
      unidade: string;
      valor_unitario_centavos: number;
      valor_total_centavos: number;
      confianca: number;
      origem: string;
    }>;
  };
}

const xml = () => readFileSync("fixtures/notas/nota-18.xml");
const esperado = JSON.parse(readFileSync("fixtures/notas/nota-18.esperado.json", "utf8")) as {
  fornecedor: { nome: string; cnpj: string };
  data_emissao: string;
  total_centavos: number;
  itens: Array<Record<string, unknown>>;
};
const manifesto = (
  JSON.parse(readFileSync("fixtures/notas/manifesto.json", "utf8")) as Array<{
    id: string;
    vinculos_produto: string[];
  }>
).find((n) => n.id === "nota-18")!;

describe("ingestão de NF-e em XML (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-nfe-"));
  let chamadasAoModelo = 0;
  const clienteFalso: ClienteVisao = {
    extrair() {
      chamadasAoModelo++;
      return Promise.reject(new Error("a NF-e não pode chamar o modelo"));
    },
  };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let a = "";
  let b = "";
  const produtoDb = new Map<string, string>();

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const enviar = (comerciante: string, conteudo: Buffer) =>
    request(servidor())
      .post("/documentos/notas")
      .set("X-Comerciante-Id", comerciante)
      .attach("arquivo", conteudo, { filename: "nfe.xml", contentType: "application/xml" });
  const consultar = async (comerciante: string, id: string) =>
    (await request(servidor()).get(`/documentos/${id}`).set("X-Comerciante-Id", comerciante).expect(200))
      .body as Documento;

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E NF-e A" }, { nome: "E2E NF-e B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;
    const catalogo = JSON.parse(readFileSync("fixtures/mercadinho/catalogo.json", "utf8")) as Produto[];
    const produtos = await db
      .insert(schema.produto)
      .values(
        catalogo.map((p) => ({
          comercianteId: a,
          nome: p.nome,
          codigoBarras: p.codigo_barras,
          unidade: p.unidade,
          categoria: p.categoria,
          origem: "planilha" as const,
        })),
      )
      .returning({ id: schema.produto.id, codigoBarras: schema.produto.codigoBarras });
    for (const p of catalogo)
      produtoDb.set(p.id, produtos.find((x) => x.codigoBarras === p.codigo_barras)!.id);

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_VISAO)
      .useValue(clienteFalso)
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

  it("o XML de exemplo vira compra e itens iguais ao gabarito, sem chamar o modelo", async () => {
    const r = (await enviar(a, xml()).expect(202)).body as Envio;
    expect(r).toMatchObject({ status: "extraido", duplicado: false });

    const doc = await consultar(a, r.documento_id);
    expect(doc.tipo).toBe("nfe");
    const c = doc.compra!;
    expect(c.data).toBe(esperado.data_emissao);
    expect(c.fornecedor).toEqual({ nome: esperado.fornecedor.nome, cnpj: esperado.fornecedor.cnpj });
    expect(c.total_centavos).toBe(esperado.total_centavos);
    expect(c.soma_itens_centavos).toBe(esperado.total_centavos);
    expect(
      c.itens.map((i) => ({
        descricao: i.descricao,
        quantidade: i.quantidade,
        unidade: i.unidade,
        valor_unitario_centavos: i.valor_unitario_centavos,
        valor_total_centavos: i.valor_total_centavos,
        confianca: i.confianca,
      })),
    ).toEqual(esperado.itens);
    expect(c.itens.every((i) => i.origem === "nfe")).toBe(true);

    const [compra] = await db.select().from(schema.compra).where(eq(schema.compra.comercianteId, a));
    expect(compra).toMatchObject({ origem: "nfe", numeroDocumento: "55731", confianca: 1 });
    const [forn] = await db.select().from(schema.fornecedor).where(eq(schema.fornecedor.comercianteId, a));
    expect(forn!.origem).toBe("nfe");

    // Item ligado a produto nunca liga ao errado, e o custo gravado é o do XML.
    const certos = new Set(manifesto.vinculos_produto.map((p) => produtoDb.get(p)));
    const itens = await db.select().from(schema.itemDeCompra).where(eq(schema.itemDeCompra.comercianteId, a));
    for (const i of itens) if (i.produtoId) expect(certos.has(i.produtoId)).toBe(true);
    const historico = await db
      .select()
      .from(schema.historicoCusto)
      .where(eq(schema.historicoCusto.comercianteId, a));
    expect(historico.every((h) => h.origem === "nfe")).toBe(true);
    expect(historico).toHaveLength(itens.filter((i) => i.produtoId).length);

    expect(chamadasAoModelo).toBe(0);
  });

  it("reenviar o mesmo arquivo é duplicado: uma compra só e histórico intacto", async () => {
    const antes = await db
      .select()
      .from(schema.historicoCusto)
      .where(eq(schema.historicoCusto.comercianteId, a));
    const r = (await enviar(a, xml()).expect(202)).body as Envio;
    expect(r.duplicado).toBe(true);
    const compras = await db.select().from(schema.compra).where(eq(schema.compra.comercianteId, a));
    expect(compras).toHaveLength(1);
    const depois = await db
      .select()
      .from(schema.historicoCusto)
      .where(eq(schema.historicoCusto.comercianteId, a));
    expect(depois).toHaveLength(antes.length);
  });

  it("outro comerciante envia o mesmo XML, ganha o próprio documento e o primeiro não o enxerga", async () => {
    const r = (await enviar(b, xml()).expect(202)).body as Envio;
    expect(r.duplicado).toBe(false);
    await request(servidor()).get(`/documentos/${r.documento_id}`).set("X-Comerciante-Id", a).expect(404);
  });

  it("XML com entidade externa (XXE) é recusado e não deixa documento", async () => {
    const antes = await db.select().from(schema.documento).where(eq(schema.documento.comercianteId, a));
    const mau = Buffer.from(
      `<?xml version="1.0"?><!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><nfeProc><NFe><infNFe>&x;</infNFe></NFe></nfeProc>`,
    );
    await enviar(a, mau).expect(422);
    const depois = await db.select().from(schema.documento).where(eq(schema.documento.comercianteId, a));
    expect(depois).toHaveLength(antes.length);
  });

  it("total da nota que não fecha com os itens vai para revisão com pergunta ao dono", async () => {
    const adulterado = Buffer.from(xml().toString("utf8").replace("<vNF>231.60</vNF>", "<vNF>300.00</vNF>"));
    const r = (await enviar(a, adulterado).expect(202)).body as Envio;
    expect(r.status).toBe("revisao");
    const doc = await consultar(a, r.documento_id);
    expect(doc.motivos.map((m) => m.codigo)).toContain("soma_diverge_do_total");
    const perguntas = await db
      .select()
      .from(schema.perguntaDono)
      .where(eq(schema.perguntaDono.comercianteId, a));
    expect(perguntas.some((p) => p.tipo === "confirmar_documento")).toBe(true);
    expect(chamadasAoModelo).toBe(0);
  });
});
