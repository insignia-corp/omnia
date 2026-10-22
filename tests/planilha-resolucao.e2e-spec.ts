import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { carregarEnv } from "../src/config/env";
import { CONFIANCA_REDUZIDA } from "../src/ingestao/validacao/validar-nota";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";

/**
 * Resolução da planilha com linha rejeitada (#142): o documento fica em `revisao` e as vendas dele
 * em confiança reduzida até o dono resolver; ao resolver, o documento vai a `extraido`, a confiança
 * volta ao valor original e nada é apagado (regra 10).
 */

const DIA = "2026-10-20";
const CABECALHO = "Data;Hora;Cupom;Código de barras;Produto;Qtd;Preço unit. (R$);Total (R$)";
const BARRAS = "7891000100103";

describe("resolução de planilha com linha rejeitada (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-resolucao-"));
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let repositorio: RepositorioMetricasPostgres;
  let a = "";
  let b = "";
  let documentoId = "";
  let mapeamento: Record<string, string> = {};

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const enviar = (dono: string, conteudo: string) =>
    request(servidor())
      .post("/documentos/planilhas")
      .set("X-Comerciante-Id", dono)
      .attach("arquivo", Buffer.from(conteudo), "vendas.csv");
  const resolver = (dono: string, id: string, corpo: object = { decisao: "descartar" }) =>
    request(servidor())
      .post(`/documentos/planilhas/${id}/resolver`)
      .set("X-Comerciante-Id", dono)
      .send(corpo);
  const confiancaDoDia = async () =>
    (await repositorio.vendasPorDia(a, DIA, DIA)).map((d) => [d.data, d.menorConfianca]);
  const planilha = (...linhas: string[]) => [CABECALHO, ...linhas].join("\n");
  const linhaBoa = `20/10/2026;10:00;5001;${BARRAS};Arroz;2;24,90;49,80`;
  const linhaRuim = "20/10/2026;10:01;5002;0000000000000;Produto que não existe;1;1,00;1,00";

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    repositorio = new RepositorioMetricasPostgres(db);
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Resolução A" }, { nome: "E2E Resolução B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;
    for (const dono of [a, b]) {
      await db
        .insert(schema.produto)
        .values({ comercianteId: dono, nome: "Arroz", codigoBarras: BARRAS, origem: "planilha" });
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();

    const primeira = await enviar(a, planilha(linhaBoa, linhaRuim)).expect(200);
    mapeamento = (primeira.body as { mapeamento_sugerido: Record<string, string> }).mapeamento_sugerido;
    const importada = await request(servidor())
      .post(`/documentos/planilhas/${(primeira.body as { documento_id: string }).documento_id}/confirmar`)
      .set("X-Comerciante-Id", a)
      .send({ mapeamento })
      .expect(200);
    documentoId = (importada.body as { documento_id: string }).documento_id;
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, a));
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, b));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("com linha rejeitada o documento fica em revisão e a venda importada vale com confiança reduzida", async () => {
    const doc = await db.select().from(schema.documento).where(eq(schema.documento.id, documentoId));
    expect(doc[0]?.statusExtracao).toBe("revisao");
    expect(await confiancaDoDia()).toEqual([[DIA, CONFIANCA_REDUZIDA]]);
  });

  it("outro lojista não resolve a planilha deste, e decisão fora do contrato é recusada", async () => {
    await resolver(b, documentoId).expect(404);
    await resolver(a, documentoId, { decisao: "confirmar" }).expect(400);
    await resolver(a, documentoId, {}).expect(400);
    const doc = await db.select().from(schema.documento).where(eq(schema.documento.id, documentoId));
    expect(doc[0]?.statusExtracao).toBe("revisao");
  });

  it("ao resolver, o documento vai a extraído, a confiança volta ao original e as linhas rejeitadas ficam", async () => {
    const r = await resolver(a, documentoId).expect(200);
    const corpo = r.body as {
      status: string;
      importacao: {
        total_rejeitadas: number;
        linhas_rejeitadas: Array<{ linha: number }>;
        resolucao: { decisao: string; origem: string; em: string };
      };
    };
    expect(corpo.status).toBe("extraido");
    expect(corpo.importacao.total_rejeitadas).toBe(1);
    expect(corpo.importacao.linhas_rejeitadas).toEqual([expect.objectContaining({ linha: 3 })]);
    expect(corpo.importacao.resolucao).toMatchObject({ decisao: "descartar", origem: "dono" });
    expect(Number.isNaN(Date.parse(corpo.importacao.resolucao.em))).toBe(false);

    expect(await confiancaDoDia()).toEqual([[DIA, 1]]);
    // Nada foi apagado: a venda e o documento continuam, e o relatório guarda a linha rejeitada.
    const vendas = await pool.query("select 1 from venda where comerciante_id = $1", [a]);
    expect(vendas.rowCount).toBe(1);
  });

  it("resolver de novo, ou uma planilha que não está em revisão, devolve conflito", async () => {
    await resolver(a, documentoId).expect(409);
    const limpa = await enviar(b, planilha(linhaBoa)).expect(200);
    const idLimpa = (limpa.body as { documento_id: string }).documento_id;
    await request(servidor())
      .post(`/documentos/planilhas/${idLimpa}/confirmar`)
      .set("X-Comerciante-Id", b)
      .send({ mapeamento })
      .expect(200);
    await resolver(b, idLimpa).expect(409);
  });
});
