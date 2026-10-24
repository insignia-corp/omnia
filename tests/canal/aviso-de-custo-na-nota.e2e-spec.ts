import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
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
import { normalizarDescricao } from "../../src/ingestao/normalizar-descricao";
import { ModeloFalso } from "../demo/modelo-falso";

interface ItemNota {
  descricao: string;
  quantidade: number;
  unidade: string;
  valor_unitario_centavos: number;
  valor_total_centavos: number;
  confianca: number;
}

/** Os 4 itens da DANFE do vídeo (fixtures/pitch), com o custo do café trocável. */
const esperada = JSON.parse(readFileSync("fixtures/pitch/danfe-video.esperado.json", "utf8")) as {
  fornecedor: { nome: string; cnpj: string };
  itens: ItemNota[];
};

/** Resposta do cliente de visão falso: a nota do vídeo, com o custo unitário do café informado. */
function respostaDaNota(data: string, custoCafe: number): RespostaVisao {
  const itens = esperada.itens.map((i) =>
    i.descricao.startsWith("CAFE")
      ? { ...i, valor_unitario_centavos: custoCafe, valor_total_centavos: custoCafe * i.quantidade }
      : i,
  );
  const nota = {
    fornecedor: esperada.fornecedor,
    data_emissao: data,
    itens,
    total_centavos: itens.reduce((s, i) => s + i.valor_total_centavos, 0),
    confianca_documento: 1,
  };
  return {
    texto: JSON.stringify(nota),
    recusou: false,
    consumo: { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 },
    modelo: "claude-sonnet-5-5",
  };
}

describe("aviso de custo na nota lida (e2e, cliente de visão falso)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-custo-"));
  const passos: RespostaVisao[] = [];
  const visao: ClienteVisao = {
    extrair: () => {
      const passo = passos.shift();
      return passo ? Promise.resolve(passo) : Promise.reject(new Error("passo não previsto no teste"));
    },
  };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const comerciantes: string[] = [];

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const como = (id: string) => ({ "X-Comerciante-Id": id });

  /** Comerciante com o fornecedor e os 4 produtos já ligados às descrições da nota (confirmado pelo dono). */
  async function novoComerciante(nome: string): Promise<string> {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning({ id: schema.comerciante.id });
    const id = c!.id;
    comerciantes.push(id);
    const [f] = await db
      .insert(schema.fornecedor)
      .values({
        comercianteId: id,
        nome: esperada.fornecedor.nome,
        cnpj: esperada.fornecedor.cnpj,
        origem: "dono",
        confianca: 1,
      })
      .returning({ id: schema.fornecedor.id });
    for (const item of esperada.itens) {
      const [p] = await db
        .insert(schema.produto)
        .values({ comercianteId: id, nome: item.descricao, origem: "dono", confianca: 1 })
        .returning({ id: schema.produto.id });
      await db.insert(schema.vinculoDescricaoProduto).values({
        comercianteId: id,
        fornecedorId: f!.id,
        descricaoNormalizada: normalizarDescricao(item.descricao),
        produtoId: p!.id,
        metodo: "dono",
        confianca: 1,
        confirmadoPeloDono: true,
        confirmadoEm: new Date(),
      });
    }
    return id;
  }

  /** Manda uma "foto" pelo chat e espera a mensagem de nota lida montada pelo código. */
  async function enviarNota(id: string, arquivo: string, resposta: RespostaVisao): Promise<string> {
    passos.push(resposta);
    const r = await request(servidor())
      .post("/chat/notas")
      .set(como(id))
      .attach("arquivo", readFileSync(`fixtures/notas/${arquivo}`), {
        filename: arquivo,
        contentType: "image/jpeg",
      })
      .expect(202);
    const chave = `nota_lida_${(r.body as { documento_id: string }).documento_id}`;
    for (let i = 0; i < 150; i++) {
      const [m] = await db
        .select({ texto: schema.mensagem.texto })
        .from(schema.mensagem)
        .where(and(eq(schema.mensagem.comercianteId, id), eq(schema.mensagem.chaveIdempotencia, chave)));
      if (m) return m.texto;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error("a nota lida não saiu");
  }

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
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
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, comerciantes));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("café mais caro que na compra anterior gera o aviso, e só ele", async () => {
    const id = await novoComerciante("E2E custo sobe");
    await enviarNota(id, "nota-01.jpg", respostaDaNota("2026-10-20", 1690));
    const texto = await enviarNota(id, "nota-02.jpg", respostaDaNota("2026-10-23", 1870));
    expect(texto).toBe(
      [
        "Nota da Distribuidora São Jorge recebida: 4 itens, total R$ 530,88.",
        "Atenção: CAFE TORRADO 500G, a última compra foi por R$ 16,90 e agora veio por R$ 18,70 (alta de 10,65%).",
      ].join("\n"),
    );
  });

  it("custos iguais aos da compra anterior geram só a confirmação", async () => {
    const id = await novoComerciante("E2E custo igual");
    await enviarNota(id, "nota-01.jpg", respostaDaNota("2026-10-20", 1690));
    const texto = await enviarNota(id, "nota-02.jpg", respostaDaNota("2026-10-23", 1690));
    expect(texto).toBe(
      "Nota da Distribuidora São Jorge recebida: 4 itens, total R$ 509,28. Tudo certo com os preços.",
    );
  });

  it("primeira nota do produto, sem compra anterior, também só confirma", async () => {
    const id = await novoComerciante("E2E custo sem anterior");
    const texto = await enviarNota(id, "nota-01.jpg", respostaDaNota("2026-10-23", 1870));
    expect(texto).toContain("Tudo certo com os preços.");
    expect(texto).not.toContain("Atenção");
  });
});
