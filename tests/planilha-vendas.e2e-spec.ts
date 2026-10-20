import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
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

interface EstadoApi {
  documento_id: string;
  status: string;
  duplicado: boolean;
  precisa_confirmar: boolean;
  cabecalhos?: string[];
  mapeamento_sugerido?: Record<string, string>;
  campos_faltando?: string[];
  importacao?: {
    linhas_lidas: number;
    vendas_importadas: number;
    vendas_ja_existentes: number;
    itens_importados: number;
    total_rejeitadas: number;
    linhas_rejeitadas: Array<{ linha: number; motivo: string }>;
  };
}

const csv = readFileSync("fixtures/mercadinho/vendas.csv");
const xlsx = readFileSync("fixtures/mercadinho/vendas.xlsx");
const catalogo = JSON.parse(readFileSync("fixtures/mercadinho/catalogo.json", "utf8")) as Array<{
  nome: string;
  codigo_barras: string;
  unidade: string;
  categoria: string;
}>;
const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  resumo_diario: { referencia: { data: string; faturamento_centavos: number; cupons: number } };
};
const referencia = gabarito.resumo_diario.referencia;

describe("importação da planilha de vendas (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-planilha-"));
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let a = "";
  let b = "";
  let mapeamentoA: Record<string, string> = {};

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const enviar = (comerciante: string, arquivo: Buffer, nome: string) =>
    request(servidor())
      .post("/documentos/planilhas")
      .set("X-Comerciante-Id", comerciante)
      .attach("arquivo", arquivo, nome);
  const enviarOk = async (comerciante: string, arquivo: Buffer, nome: string): Promise<EstadoApi> =>
    (await enviar(comerciante, arquivo, nome).expect(200)).body as EstadoApi;
  const confirmar = (comerciante: string, id: string, mapeamento: object) =>
    request(servidor())
      .post(`/documentos/planilhas/${id}/confirmar`)
      .set("X-Comerciante-Id", comerciante)
      .send({ mapeamento });
  const contar = async (tabela: string, comerciante: string): Promise<number> =>
    (
      await pool.query<{ n: number }>(`select count(*)::int as n from ${tabela} where comerciante_id = $1`, [
        comerciante,
      ])
    ).rows[0]!.n;
  const doDia = async (comerciante: string) =>
    (
      await pool.query<{ cupons: number; total: string }>(
        "select count(*)::int as cupons, coalesce(sum(total_centavos), 0)::text as total from venda where comerciante_id = $1 and data = $2",
        [comerciante, referencia.data],
      )
    ).rows[0]!;

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    // Planilha de 11 mil linhas: o limite padrão de 10 MB sobra, mas o teste não depende dele.
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Planilha A" }, { nome: "E2E Planilha B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;
    for (const dono of [a, b]) {
      await db.insert(schema.produto).values(
        catalogo.map((p) => ({
          comercianteId: dono,
          nome: p.nome,
          codigoBarras: p.codigo_barras,
          unidade: p.unidade,
          categoria: p.categoria,
          origem: "planilha" as const,
        })),
      );
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  // Apagar em cascata ~15 mil linhas por lojista leva segundos: o limite padrão de 30 s é curto para CI lenta.
  afterAll(async () => {
    await app?.close();
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, [a, b]));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  }, 120_000);

  it("recusa arquivo que não é planilha e envio sem arquivo", async () => {
    await enviar(a, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), "foto.jpg").expect(415);
    await request(servidor()).post("/documentos/planilhas").set("X-Comerciante-Id", a).expect(400);
  });

  describe("primeira planilha de um formato: o dono confirma o mapeamento", () => {
    let documentoA = "";

    it("devolve a sugestão de colunas e ainda não importa nada", async () => {
      const r = await enviarOk(a, csv, "vendas.csv");
      documentoA = r.documento_id;
      expect(r).toMatchObject({
        status: "pendente",
        duplicado: false,
        precisa_confirmar: true,
        campos_faltando: [],
      });
      expect(r.mapeamento_sugerido).toEqual({
        data: "Data",
        hora: "Hora",
        cupom: "Cupom",
        codigo_barras: "Código de barras",
        produto: "Produto",
        quantidade: "Qtd",
        preco_unitario: "Preço unit. (R$)",
        total: "Total (R$)",
      });
      mapeamentoA = r.mapeamento_sugerido!;
      expect(await contar("venda", a)).toBe(0);
    });

    it("recusa mapeamento com coluna inexistente ou sem campo obrigatório", async () => {
      await confirmar(a, documentoA, { ...mapeamentoA, produto: "Coluna que não existe" }).expect(400);
      await confirmar(a, documentoA, { data: "Data" }).expect(400);
      await confirmar(a, documentoA, { ...mapeamentoA, campo_inventado: "Data" }).expect(400);
      expect(await contar("venda", a)).toBe(0);
    });

    it("confirmado, importa tudo e bate com o gabarito da Etapa 1", async () => {
      const res = await confirmar(a, documentoA, mapeamentoA).expect(200);
      const r = res.body as EstadoApi;
      expect(r).toMatchObject({ status: "extraido", precisa_confirmar: false });
      expect(r.importacao).toMatchObject({
        linhas_lidas: 11_365,
        vendas_importadas: 3623,
        vendas_ja_existentes: 0,
        itens_importados: 11_365,
        total_rejeitadas: 0,
        linhas_rejeitadas: [],
      });
      expect(await contar("venda", a)).toBe(3623);
      expect(await contar("item_de_venda", a)).toBe(11_365);
      expect(await doDia(a)).toEqual({
        cupons: referencia.cupons,
        total: String(referencia.faturamento_centavos),
      });
      const origens = await pool.query<{ origem: string }>(
        "select distinct origem from venda where comerciante_id = $1",
        [a],
      );
      expect(origens.rows).toEqual([{ origem: "planilha" }]);
    }, 60_000);

    it("enviar o mesmo arquivo de novo não importa outra vez, e não se confirma duas vezes", async () => {
      const r = await enviarOk(a, csv, "vendas.csv");
      expect(r).toMatchObject({ documento_id: documentoA, duplicado: true, status: "extraido" });
      expect(r.importacao?.vendas_importadas).toBe(3623);
      await confirmar(a, documentoA, mapeamentoA).expect(409);
      expect(await contar("venda", a)).toBe(3623);
    });
  });

  describe("planilha seguinte do mesmo formato", () => {
    it("reaproveita o mapeamento: importa só o que é novo e lista a linha rejeitada", async () => {
      const cabecalho = csv.toString("utf8").split("\n", 1)[0]!;
      const primeiraLinha = csv.toString("utf8").split("\n")[1]!;
      const barras = catalogo[0]!.codigo_barras;
      const nova = [
        cabecalho,
        primeiraLinha, // cupom que já existe
        `20/10/2026;10:00;999001;${barras};${catalogo[0]!.nome};2;24,90;49,80`,
        "20/10/2026;10:01;999002;0000000000000;Coisa que não existe;1;1,00;1,00",
      ].join("\n");

      const r = await enviarOk(a, Buffer.from(nova), "vendas-outubro.csv");
      expect(r).toMatchObject({ status: "revisao", precisa_confirmar: false, duplicado: false });
      expect(r.importacao).toMatchObject({
        linhas_lidas: 3,
        vendas_importadas: 1,
        vendas_ja_existentes: 1,
        itens_importados: 1,
        total_rejeitadas: 1,
      });
      expect(r.importacao?.linhas_rejeitadas).toEqual([
        { linha: 4, motivo: expect.stringContaining("Produto não encontrado no cadastro") as string },
      ]);
      expect(await contar("venda", a)).toBe(3624);
      expect(await contar("item_de_venda", a)).toBe(11_366);

      const estado = await request(servidor())
        .get(`/documentos/${r.documento_id}`)
        .set("X-Comerciante-Id", a)
        .expect(200);
      expect((estado.body as { importacao: { total_rejeitadas: number } }).importacao.total_rejeitadas).toBe(
        1,
      );
    });
  });

  describe("outro lojista, outro formato de arquivo", () => {
    it("o mapeamento de A não vale para B: B confirma o dele, com XLSX, e o resultado é o mesmo", async () => {
      const r = await enviarOk(b, xlsx, "vendas.xlsx");
      expect(r.precisa_confirmar).toBe(true);
      expect(await contar("venda", b)).toBe(0);

      await confirmar(a, r.documento_id, r.mapeamento_sugerido!).expect(404);
      const confirmado = (await confirmar(b, r.documento_id, r.mapeamento_sugerido!).expect(200))
        .body as EstadoApi;
      expect(confirmado.importacao).toMatchObject({
        vendas_importadas: 3623,
        itens_importados: 11_365,
        total_rejeitadas: 0,
      });
      expect(await doDia(b)).toEqual({
        cupons: referencia.cupons,
        total: String(referencia.faturamento_centavos),
      });
      // As vendas de A não mudaram por causa da importação de B.
      expect(await contar("venda", a)).toBe(3624);
    }, 60_000);
  });
});
