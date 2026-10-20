import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, asc, eq, inArray } from "drizzle-orm";
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
import type { ClienteVisao, RespostaVisao } from "../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../src/ingestao/ingestao.module";

const esperado = (n: string) => readFileSync(`fixtures/notas/${n}.esperado.json`, "utf8");
const foto = (n: string) => readFileSync(`fixtures/notas/${n}.jpg`);
const resposta = (texto: string): RespostaVisao => ({
  texto,
  recusou: false,
  consumo: { entrada: 2100, saida: 900, cacheLeitura: 0, cacheEscrita: 0 },
  modelo: "claude-sonnet-5-5",
});
/** Nota de um item só, com o CNPJ válido da nota 1, para controlar o que o vínculo enxerga. */
const notaDeUmItem = (descricao: string, data = "2026-10-10") =>
  JSON.stringify({
    fornecedor: { nome: "Distribuidora Aurora Alimentos Ltda", cnpj: "31482907000168" },
    data_emissao: data,
    itens: [
      {
        descricao,
        quantidade: 2,
        unidade: "UN",
        valor_unitario_centavos: 2490,
        valor_total_centavos: 4980,
        confianca: 1,
      },
    ],
    total_centavos: 4980,
    confianca_documento: 1,
  });

interface DocumentoApi {
  id: string;
  status: string;
  motivos: Array<{ codigo: string }>;
  compra: null | {
    soma_itens_centavos: number;
    total_centavos: number;
    itens: Array<{
      id: string;
      ordem: number;
      descricao: string;
      confianca: number;
      origem: string;
      revisao_pendente: boolean;
    }>;
  };
}
interface PerguntaApi {
  id: string;
  tipo: string;
  pergunta: string;
  contexto: { candidatos?: Array<{ produto_id: string; nome: string }>; documento_id?: string };
  item_de_compra_id: string | null;
}

describe("revisão de itens e vínculo com o produto (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-revisao-"));
  const passos: RespostaVisao[] = [];
  const clienteFalso: ClienteVisao = {
    extrair() {
      const passo = passos.shift();
      return passo ? Promise.resolve(passo) : Promise.reject(new Error("passo não previsto no teste"));
    },
  };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ids: Record<"a" | "b" | "c", string> = { a: "", b: "", c: "" };
  const produtosC: Record<string, string> = {};

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const enviar = async (comerciante: string, nota: string): Promise<string> => {
    const res = await request(servidor())
      .post("/documentos/notas")
      .set("X-Comerciante-Id", comerciante)
      .attach("arquivo", foto(nota), { filename: `${nota}.jpg`, contentType: "image/jpeg" })
      .expect(202);
    return (res.body as { documento_id: string }).documento_id;
  };
  const aguardar = async (comerciante: string, id: string): Promise<DocumentoApi> => {
    const limite = Date.now() + 15_000;
    for (;;) {
      const res = await request(servidor())
        .get(`/documentos/${id}`)
        .set("X-Comerciante-Id", comerciante)
        .expect(200);
      const doc = res.body as DocumentoApi;
      if (doc.status !== "pendente" && doc.status !== "processando") return doc;
      if (Date.now() > limite) throw new Error(`documento ${id} não terminou`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const pendentes = async (comerciante: string): Promise<PerguntaApi[]> =>
    (await request(servidor()).get("/perguntas").set("X-Comerciante-Id", comerciante).expect(200))
      .body as PerguntaApi[];
  const responder = (comerciante: string, perguntaId: string, corpo: object) =>
    request(servidor())
      .post(`/perguntas/${perguntaId}/resposta`)
      .set("X-Comerciante-Id", comerciante)
      .send(corpo);
  const historico = (comerciante: string, itemId: string) =>
    db
      .select()
      .from(schema.historicoCusto)
      .where(
        and(
          eq(schema.historicoCusto.comercianteId, comerciante),
          eq(schema.historicoCusto.itemDeCompraId, itemId),
        ),
      )
      .orderBy(asc(schema.historicoCusto.criadoEm));

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Revisão A" }, { nome: "E2E Revisão B" }, { nome: "E2E Revisão C" }])
      .returning({ id: schema.comerciante.id });
    [ids.a, ids.b, ids.c] = criados.map((c) => c.id) as [string, string, string];

    // A e B têm o catálogo inteiro da demo: as descrições da nota 11 ligam sozinhas.
    const catalogo = JSON.parse(readFileSync("fixtures/mercadinho/catalogo.json", "utf8")) as Array<{
      nome: string;
      codigo_barras: string;
      unidade: string;
      categoria: string;
    }>;
    for (const dono of [ids.a, ids.b]) {
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
    // C tem dois feijões parecidos: "FEIJAO 1KG" não decide sozinho entre eles.
    const feijoes = await db
      .insert(schema.produto)
      .values(
        ["Feijão carioca 1kg", "Feijão preto 1kg"].map((nome) => ({
          comercianteId: ids.c,
          nome,
          origem: "planilha" as const,
        })),
      )
      .returning({ id: schema.produto.id, nome: schema.produto.nome });
    for (const f of feijoes) produtosC[f.nome] = f.id;

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLIENTE_VISAO)
      .useValue(clienteFalso)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, Object.values(ids)));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  describe("item de baixa confiança (#26)", () => {
    let doc: DocumentoApi;
    let pergunta: PerguntaApi;
    let itemDuvidoso: DocumentoApi["compra"] extends null | infer C
      ? C extends { itens: Array<infer I> }
        ? I
        : never
      : never;

    it("a nota 11 liga os itens ao catálogo, grava o histórico e pergunta só o item ilegível", async () => {
      passos.push(resposta(esperado("nota-11")));
      doc = await aguardar(ids.a, await enviar(ids.a, "nota-11"));
      expect(doc.status).toBe("revisao");
      itemDuvidoso = doc.compra!.itens.find((i) => i.revisao_pendente)!;
      expect(itemDuvidoso).toMatchObject({ ordem: 3, confianca: 0.5 });

      const ligados = await db
        .select()
        .from(schema.itemDeCompra)
        .where(eq(schema.itemDeCompra.comercianteId, ids.a));
      expect(ligados.every((i) => i.produtoId !== null)).toBe(true);
      // O item duvidoso entra no histórico já com a confiança baixa dele.
      const antes = await historico(ids.a, itemDuvidoso.id);
      expect(antes).toHaveLength(1);
      expect(antes[0]).toMatchObject({ custoUnitarioCentavos: 330, origem: "foto_nota" });
      expect(antes[0]!.confianca).toBeLessThanOrEqual(0.5);

      const lista = await pendentes(ids.a);
      expect(lista).toHaveLength(1);
      pergunta = lista[0]!;
      expect(pergunta).toMatchObject({ tipo: "confirmar_item", item_de_compra_id: itemDuvidoso.id });
      expect(pergunta.pergunta).toContain("SALG MILHO 100G");
      expect(pergunta.pergunta).toContain("R$ 3,30");
    });

    it("a resposta do dono corrige o item como origem dono, sem apagar o que o modelo leu", async () => {
      const res = await responder(ids.a, pergunta.id, { valor_unitario_centavos: 330 }).expect(200);
      expect(res.body).toMatchObject({ tipo: "confirmar_item", status_documento: "extraido" });

      const depois = await aguardar(ids.a, doc.id);
      expect(depois.status).toBe("extraido");
      expect(depois.compra!.itens.find((i) => i.ordem === 3)).toMatchObject({
        confianca: 1,
        origem: "dono",
        revisao_pendente: false,
      });
      const linhas = await historico(ids.a, itemDuvidoso.id);
      expect(linhas).toHaveLength(2);
      expect(linhas[0]!.origem).toBe("foto_nota");
      expect(linhas[1]).toMatchObject({ origem: "dono", confianca: 1, custoUnitarioCentavos: 330 });
      expect(await pendentes(ids.a)).toEqual([]);
    });

    it("não aceita responder duas vezes, nem resposta fora do formato, nem pergunta de outro lojista", async () => {
      await responder(ids.a, pergunta.id, { valor_unitario_centavos: 330 }).expect(409);
      await responder(ids.b, pergunta.id, { valor_unitario_centavos: 330 }).expect(404);
      await responder(ids.a, "00000000-0000-4000-8000-000000000000", {}).expect(404);
    });

    it("corrigir para um valor que não fecha com o total mantém a nota em revisão, com o motivo", async () => {
      passos.push(resposta(esperado("nota-11")));
      const docB = await aguardar(ids.b, await enviar(ids.b, "nota-11"));
      const perguntaB = (await pendentes(ids.b))[0]!;
      await responder(ids.b, perguntaB.id, { valor_unitario: 1 }).expect(400);
      await responder(ids.b, perguntaB.id, { valor_unitario_centavos: -5 }).expect(400);

      const res = await responder(ids.b, perguntaB.id, { valor_unitario_centavos: 350 }).expect(200);
      expect(res.body).toMatchObject({ status_documento: "revisao" });
      const depois = await aguardar(ids.b, docB.id);
      expect(depois.motivos.map((m) => m.codigo)).toEqual(["soma_diverge_do_total"]);
      // 24 unidades a R$ 3,50 no lugar de R$ 3,30: a soma sobe R$ 4,80 acima do total impresso.
      expect(depois.compra!.soma_itens_centavos).toBe(depois.compra!.total_centavos + 480);
    });
  });

  describe("vínculo por escolha do dono (#27)", () => {
    const pendentesDeVinculo = async () =>
      (await pendentes(ids.c)).filter((p) => p.tipo === "confirmar_vinculo");

    it("descrição que não decide entre dois produtos vira pergunta com os dois candidatos", async () => {
      passos.push(resposta(notaDeUmItem("FEIJAO 1KG")), resposta(notaDeUmItem("FEIJAO 1KG")));
      const [d1, d2] = [await enviar(ids.c, "nota-04"), await enviar(ids.c, "nota-05")];
      await Promise.all([aguardar(ids.c, d1), aguardar(ids.c, d2)]);

      const lista = await pendentesDeVinculo();
      expect(lista).toHaveLength(2);
      expect(lista[0]!.contexto.candidatos!.map((c) => c.nome).sort()).toEqual([
        "Feijão carioca 1kg",
        "Feijão preto 1kg",
      ]);
      expect(lista[0]!.pergunta).toContain("FEIJAO 1KG");
      const semProduto = await db
        .select()
        .from(schema.historicoCusto)
        .where(eq(schema.historicoCusto.comercianteId, ids.c));
      expect(semProduto).toEqual([]);
    });

    it("não aceita produto de outro lojista", async () => {
      const [alvo] = await db
        .select()
        .from(schema.produto)
        .where(eq(schema.produto.comercianteId, ids.a))
        .limit(1);
      const [primeira] = await pendentesDeVinculo();
      await responder(ids.c, primeira!.id, { produto_id: alvo!.id }).expect(400);
    });

    it("confirmar o vínculo liga os dois itens iguais, grava o histórico e dispensa a segunda pergunta", async () => {
      const [primeira, segunda] = await pendentesDeVinculo();
      const res = await responder(ids.c, primeira!.id, {
        produto_id: produtosC["Feijão carioca 1kg"],
      }).expect(200);
      expect(res.body).toMatchObject({ tipo: "confirmar_vinculo", itens_ligados: 2 });

      const itens = await db
        .select()
        .from(schema.itemDeCompra)
        .where(eq(schema.itemDeCompra.comercianteId, ids.c));
      expect(itens.map((i) => i.produtoId)).toEqual([
        produtosC["Feijão carioca 1kg"],
        produtosC["Feijão carioca 1kg"],
      ]);
      const linhas = await db
        .select()
        .from(schema.historicoCusto)
        .where(eq(schema.historicoCusto.comercianteId, ids.c));
      expect(linhas).toHaveLength(2);
      expect(linhas.every((l) => l.custoUnitarioCentavos === 2490 && l.origem === "foto_nota")).toBe(true);
      const [dispensada] = await db
        .select()
        .from(schema.perguntaDono)
        .where(eq(schema.perguntaDono.id, segunda!.id));
      expect(dispensada!.status).toBe("cancelada");
      expect(await pendentesDeVinculo()).toEqual([]);
    });

    it("vínculo confirmado não é perguntado de novo: a nota seguinte liga sozinha", async () => {
      passos.push(resposta(notaDeUmItem("FEIJAO 1KG", "2026-10-12")));
      const doc = await aguardar(ids.c, await enviar(ids.c, "nota-06"));
      expect(doc.status).toBe("extraido");
      expect(await pendentesDeVinculo()).toEqual([]);
      const [item] = await db
        .select()
        .from(schema.itemDeCompra)
        .where(eq(schema.itemDeCompra.id, doc.compra!.itens[0]!.id));
      expect(item!.produtoId).toBe(produtosC["Feijão carioca 1kg"]);
      expect(await historico(ids.c, item!.id)).toHaveLength(1);
      // O vínculo do dono é append-only e fica registrado com o método e a confirmação.
      const vinculos = await db
        .select()
        .from(schema.vinculoDescricaoProduto)
        .where(eq(schema.vinculoDescricaoProduto.comercianteId, ids.c));
      expect(vinculos).toEqual([
        expect.objectContaining({
          descricaoNormalizada: "FEIJAO 1KG",
          metodo: "dono",
          confirmadoPeloDono: true,
          confianca: 1,
        }),
      ]);
    });
  });

  describe("dúvida da nota inteira (revisão do Codex, PR 124)", () => {
    let doc: DocumentoApi;
    let pergunta: PerguntaApi;

    it("nota com a soma divergente gera uma pergunta de documento e limita a confiança do custo", async () => {
      passos.push(resposta(esperado("nota-10")));
      doc = await aguardar(ids.a, await enviar(ids.a, "nota-10"));
      expect(doc.status).toBe("revisao");
      expect(doc.motivos.map((m) => m.codigo)).toEqual(["soma_diverge_do_total"]);

      const doDocumento = (await pendentes(ids.a)).filter((p) => p.tipo === "confirmar_documento");
      expect(doDocumento).toHaveLength(1);
      pergunta = doDocumento[0]!;
      expect(pergunta).toMatchObject({ item_de_compra_id: null, contexto: { documento_id: doc.id } });
      expect(pergunta.pergunta).toContain("2026-09-25");

      // Os itens foram lidos com confiança 1, mas o custo não é mais confiável que a nota.
      for (const item of doc.compra!.itens) {
        for (const linha of await historico(ids.a, item.id)) expect(linha.confianca).toBeLessThanOrEqual(0.5);
      }
    });

    it("só aceita a confirmação no formato certo, e uma vez", async () => {
      await responder(ids.a, pergunta.id, {}).expect(400);
      await responder(ids.a, pergunta.id, { confirmado: false }).expect(400);
      await responder(ids.b, pergunta.id, { confirmado: true }).expect(404);
    });

    it("o dono confirma a nota: ela sai da revisão e o custo ganha uma linha com a confiança nova", async () => {
      const res = await responder(ids.a, pergunta.id, { confirmado: true }).expect(200);
      expect(res.body).toMatchObject({ tipo: "confirmar_documento", status_documento: "extraido" });
      await responder(ids.a, pergunta.id, { confirmado: true }).expect(409);

      const depois = await aguardar(ids.a, doc.id);
      expect(depois.status).toBe("extraido");
      expect(depois.motivos.map((m) => m.codigo)).toContain("documento_confirmado");
      expect((await pendentes(ids.a)).filter((p) => p.tipo === "confirmar_documento")).toEqual([]);

      const [compraDoDocumento] = await db
        .select()
        .from(schema.compra)
        .where(eq(schema.compra.documentoId, doc.id));
      const ligados = await db
        .select()
        .from(schema.itemDeCompra)
        .where(eq(schema.itemDeCompra.compraId, compraDoDocumento!.id));
      for (const item of ligados.filter((i) => i.produtoId !== null)) {
        const linhas = await historico(ids.a, item.id);
        // A linha antiga continua (histórico append-only) e a mais recente vale.
        expect(linhas.length).toBeGreaterThanOrEqual(2);
        expect(linhas.at(-1)!.confianca).toBeGreaterThan(0.5);
        expect(linhas[0]!.confianca).toBeLessThanOrEqual(0.5);
      }
    });
  });
});
