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
import {
  ErroClienteVisao,
  type ClienteVisao,
  type RespostaVisao,
} from "../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../src/ingestao/ingestao.module";

const esperado = (n: string) => readFileSync(`fixtures/notas/${n}.esperado.json`, "utf8");
const foto = (n: string) => readFileSync(`fixtures/notas/${n}.jpg`);
// O modelo devolve confiança alta mesmo quando erra: quem reduz é o código.
const comoDoModelo = (n: string) => {
  const e = JSON.parse(esperado(n));
  e.confianca_documento = 1;
  for (const i of e.itens) i.confianca = 1;
  return JSON.stringify(e);
};
const resposta = (texto: string): RespostaVisao => ({
  texto,
  recusou: false,
  consumo: { entrada: 2100, saida: 900, cacheLeitura: 0, cacheEscrita: 0 },
  modelo: "claude-sonnet-5-5",
});

interface EnvioApi {
  documento_id: string;
  status: string;
  duplicado: boolean;
}

interface DocumentoApi {
  id: string;
  status: string;
  confianca_media: number | null;
  motivos: Array<{ codigo: string }>;
  erro: string | null;
  compra: null | {
    id: string;
    data: string;
    fornecedor: { nome: string; cnpj: string };
    total_centavos: number;
    soma_itens_centavos: number;
    itens: Array<{ ordem: number; confianca: number; origem: string; revisao_pendente: boolean }>;
  };
}

describe("ingestão de notas (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-"));
  const passos: Array<RespostaVisao | Error> = [];
  let chamadasAoModelo = 0;
  const clienteFalso: ClienteVisao = {
    extrair() {
      chamadasAoModelo++;
      const passo = passos.shift();
      if (!passo) return Promise.reject(new Error("passo não previsto no teste"));
      return passo instanceof Error ? Promise.reject(passo) : Promise.resolve(passo);
    },
  };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let a = "";
  let b = "";

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const enviar = (comerciante: string, nota: string) =>
    request(servidor())
      .post("/documentos/notas")
      .set("X-Comerciante-Id", comerciante)
      .attach("arquivo", foto(nota), { filename: `${nota}.jpg`, contentType: "image/jpeg" });
  const enviarOk = async (comerciante: string, nota: string): Promise<EnvioApi> =>
    (await enviar(comerciante, nota).expect(202)).body as EnvioApi;
  const consultar = (comerciante: string, id: string) =>
    request(servidor()).get(`/documentos/${id}`).set("X-Comerciante-Id", comerciante);
  /** Espera o job terminar (o worker roda em segundo plano). */
  const aguardar = async (comerciante: string, id: string, ms = 15_000): Promise<DocumentoApi> => {
    const limite = Date.now() + ms;
    for (;;) {
      const doc = (await consultar(comerciante, id).expect(200)).body as DocumentoApi;
      if (doc.status !== "pendente" && doc.status !== "processando") return doc;
      if (Date.now() > limite) throw new Error(`documento ${id} não terminou: ${doc.status}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Ingestão A" }, { nome: "E2E Ingestão B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;

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

  describe("sessão e upload", () => {
    it("recusa chamada sem comerciante, com id inválido ou de comerciante que não existe", async () => {
      await request(servidor()).post("/documentos/notas").expect(401);
      await request(servidor()).post("/documentos/notas").set("X-Comerciante-Id", "nao-e-uuid").expect(401);
      await request(servidor())
        .post("/documentos/notas")
        .set("X-Comerciante-Id", "00000000-0000-4000-8000-000000000000")
        .expect(401);
    });

    it("recusa upload sem arquivo e arquivo que não é foto", async () => {
      await request(servidor()).post("/documentos/notas").set("X-Comerciante-Id", a).expect(400);
      await request(servidor())
        .post("/documentos/notas")
        .set("X-Comerciante-Id", a)
        .attach("arquivo", Buffer.from("Data;Produto\n1;2\n"), "vendas.csv")
        .expect(415);
    });
  });

  describe("da foto ao banco", () => {
    let documentoNota11 = "";

    it("nota 11: o item pouco legível deixa o documento em revisão, com a confiança de cada item", async () => {
      passos.push(resposta(esperado("nota-11")));
      const enviado = await enviarOk(a, "nota-11");
      expect(enviado).toMatchObject({ status: "pendente", duplicado: false });
      documentoNota11 = enviado.documento_id;

      const doc = await aguardar(a, documentoNota11);
      expect(doc.status).toBe("revisao");
      expect(doc.motivos).toEqual([]);
      expect(doc.compra!.fornecedor.cnpj).toBe("22786541000120");
      expect(doc.compra!.data).toBe("2026-09-30");
      expect(doc.compra!.total_centavos).toBe(JSON.parse(esperado("nota-11")).total_centavos);
      const baixas = doc.compra!.itens.filter((i) => i.revisao_pendente);
      expect(baixas).toHaveLength(1);
      expect(baixas[0]).toMatchObject({ ordem: 3, confianca: 0.5, origem: "foto_nota" });
      // Sem produto ligado (issue #27), nenhum custo entra no histórico ainda.
      const historico = await pool.query(
        "select count(*)::int as n from historico_custo where comerciante_id = $1",
        [a],
      );
      expect(historico.rows[0].n).toBe(0);
    });

    it("guarda a saída do modelo como veio e registra a execução com tokens e custo", async () => {
      const [doc] = await db.select().from(schema.documento).where(eq(schema.documento.id, documentoNota11));
      expect(doc?.extracaoJson).toEqual(JSON.parse(esperado("nota-11")));
      expect(doc?.arquivoCaminho).toMatch(new RegExp(`^${a}/[0-9a-f]{64}\\.jpg$`));

      const execucoes = await db
        .select()
        .from(schema.execucaoAgente)
        .where(eq(schema.execucaoAgente.comercianteId, a));
      const execucao = execucoes.find((e) => e.entrada === `documento:${documentoNota11}`);
      expect(execucao).toMatchObject({
        gatilho: "extracao_nota",
        resultado: "aprovada",
        modelo: "claude-sonnet-5-5",
        versaoPrompt: "extrator-v1",
        tokensEntrada: 2100,
        tokensSaida: 900,
      });
      expect(execucao?.custoEstimadoMicrodolares).toBeGreaterThan(0);
    });

    it("enviar o mesmo arquivo de novo devolve o mesmo documento e não gasta outra chamada", async () => {
      const antes = chamadasAoModelo;
      const repetido = await enviarOk(a, "nota-11");
      expect(repetido).toMatchObject({
        documento_id: documentoNota11,
        duplicado: true,
        status: "revisao",
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(chamadasAoModelo).toBe(antes);
      const compras = await pool.query("select count(*)::int as n from compra where comerciante_id = $1", [
        a,
      ]);
      expect(compras.rows[0].n).toBe(1);
    });

    it("nota 10: a soma que não bate reduz a confiança do documento e deixa o motivo", async () => {
      passos.push(resposta(comoDoModelo("nota-10")));
      const enviado = await enviarOk(a, "nota-10");
      const doc = await aguardar(a, enviado.documento_id);
      expect(doc.status).toBe("revisao");
      expect(doc.motivos.map((m) => m.codigo)).toEqual(["soma_diverge_do_total"]);
      expect(doc.confianca_media).toBeLessThan(0.8);
      expect(doc.compra!.soma_itens_centavos).toBe(69640);
      expect(doc.compra!.total_centavos).toBe(70880);
    });

    it("nota sem problema fica em extraido", async () => {
      passos.push(resposta(comoDoModelo("nota-01")));
      const enviado = await enviarOk(a, "nota-01");
      const doc = await aguardar(a, enviado.documento_id);
      expect(doc.status).toBe("extraido");
      expect(doc.motivos).toEqual([]);
    });
  });

  describe("dados de entrada problemáticos", () => {
    const comAlteracao = (nota: string, alterar: (e: Record<string, unknown>) => void) => {
      const e = JSON.parse(comoDoModelo(nota)) as Record<string, unknown>;
      alterar(e);
      return JSON.stringify(e);
    };
    const fornecedorDaCompra = async (compraId: string) =>
      (await pool.query("select fornecedor_id from compra where id = $1", [compraId])).rows[0]
        .fornecedor_id as string;

    it("data que não existe no calendário não derruba a gravação: cai na data do envio, com o motivo", async () => {
      passos.push(resposta(comAlteracao("nota-07", (e) => (e.data_emissao = "2026-02-31"))));
      const enviado = await enviarOk(a, "nota-07");
      const doc = await aguardar(a, enviado.documento_id);
      expect(doc.status).not.toBe("processando");
      expect(doc.motivos.map((m) => m.codigo)).toContain("data_invalida");
      expect(doc.confianca_media).toBeLessThanOrEqual(0.5);
      const [linha] = await db
        .select()
        .from(schema.documento)
        .where(eq(schema.documento.id, enviado.documento_id));
      expect(doc.compra!.data).toBe(linha!.criadoEm.toISOString().slice(0, 10));
      // O que o modelo leu continua guardado como veio.
      expect((linha!.extracaoJson as { data_emissao: string }).data_emissao).toBe("2026-02-31");
    });

    it("CNPJ ilegível fica nulo: fornecedores sem CNPJ não se juntam, só o de mesmo nome se reaproveita", async () => {
      const semCnpj = (nota: string, nome: string) =>
        comAlteracao(nota, (e) => {
          e.fornecedor = { nome, cnpj: "ilegível" };
        });
      passos.push(
        resposta(semCnpj("nota-04", "Distribuidora Sem CNPJ")),
        resposta(semCnpj("nota-05", "Atacado Outro")),
        resposta(semCnpj("nota-06", "DISTRIBUIDORA SEM CNPJ")),
      );
      const docs = [] as DocumentoApi[];
      for (const nota of ["nota-04", "nota-05", "nota-06"]) {
        docs.push(await aguardar(a, (await enviarOk(a, nota)).documento_id));
      }
      const [d1, d2, d3] = await Promise.all(docs.map((d) => fornecedorDaCompra(d.compra!.id)));
      expect(d1).not.toBe(d2);
      expect(d3).toBe(d1);
      const nulos = await pool.query(
        "select count(*)::int as n from fornecedor where comerciante_id = $1 and cnpj is null",
        [a],
      );
      expect(nulos.rows[0].n).toBe(2);
      expect(docs.every((d) => d.motivos.map((m) => m.codigo).includes("cnpj_invalido"))).toBe(true);
    });
  });

  describe("falhas", () => {
    it("imagem ilegível vira falha, sem compra e com a execução registrada", async () => {
      passos.push(resposta(JSON.stringify({ erro: "ilegivel", motivo: "foto escura" })));
      const enviado = await enviarOk(a, "nota-12");
      const doc = await aguardar(a, enviado.documento_id);
      expect(doc.status).toBe("falha");
      expect(doc.erro).toBe("ilegivel: foto escura");
      expect(doc.compra).toBeNull();
      const [execucao] = await db
        .select()
        .from(schema.execucaoAgente)
        .where(eq(schema.execucaoAgente.entrada, `documento:${enviado.documento_id}`));
      expect(execucao).toMatchObject({ gatilho: "extracao_nota", resultado: "fallback_erro" });
    });

    it("JSON inválido duas vezes vira falha e nada é gravado", async () => {
      passos.push(resposta("{ não é json"), resposta("{ ainda não }"));
      const enviado = await enviarOk(a, "nota-02");
      const doc = await aguardar(a, enviado.documento_id);
      expect(doc.status).toBe("falha");
      expect(doc.erro).toMatch(/^json_invalido/);
      expect(doc.compra).toBeNull();
    });

    it("erro transitório da API: o BullMQ repete o job e a nota é extraída", async () => {
      passos.push(new ErroClienteVisao("timeout", true), resposta(comoDoModelo("nota-03")));
      const enviado = await enviarOk(a, "nota-03");
      const doc = await aguardar(a, enviado.documento_id, 25_000);
      expect(doc.status).toBe("extraido");
    }, 30_000);
  });

  describe("isolamento entre lojistas (regra inviolável 3)", () => {
    it("o lojista B não lê o documento do lojista A", async () => {
      const [doc] = await db
        .select()
        .from(schema.documento)
        .where(eq(schema.documento.comercianteId, a))
        .limit(1);
      await consultar(b, doc!.id).expect(404);
    });

    it("o mesmo arquivo enviado por B vira um documento de B, separado do de A", async () => {
      passos.push(resposta(comoDoModelo("nota-11")));
      const enviado = await enviarOk(b, "nota-11");
      expect(enviado.duplicado).toBe(false);
      const doc = await aguardar(b, enviado.documento_id);
      expect(doc.compra?.id).toBeDefined();
      const donos = await pool.query(
        "select comerciante_id from documento where id = $1 union all select comerciante_id from compra where id = $2",
        [enviado.documento_id, doc.compra!.id],
      );
      expect(donos.rows.every((l: { comerciante_id: string }) => l.comerciante_id === b)).toBe(true);
      await consultar(a, enviado.documento_id).expect(404);
    });
  });
});
