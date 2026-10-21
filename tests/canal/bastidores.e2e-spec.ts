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
import type { PainelBastidores } from "../../src/canal/bastidores/tipos";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import type { ClienteVisao, RespostaVisao } from "../../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";
import { ModeloFalso } from "../demo/modelo-falso";

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

describe("bastidores (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-bastidores-"));
  const visao: ClienteVisao = { extrair: () => Promise.resolve(comoDoModelo("nota-01")) };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let a = "";
  let b = "";
  let execucaoId = "";

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const painel = async (id: string) =>
    (await request(servidor()).get("/bastidores/painel").set("X-Comerciante-Id", id).expect(200))
      .body as PainelBastidores;

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Bastidores A" }, { nome: "E2E Bastidores B" }])
      .returning({ id: schema.comerciante.id });
    a = criados[0]!.id;
    b = criados[1]!.id;

    // Uma execução com duas chamadas de ferramenta e um bloqueio do verificador, como o registro grava.
    const [exec] = await db
      .insert(schema.execucaoAgente)
      .values({
        comercianteId: a,
        gatilho: "mensagem_dono",
        entrada: "Como está a margem?",
        modelo: "claude-opus-5-5",
        versaoPrompt: "v1",
        resultado: "aprovada",
        mensagemFinal: "A margem do arroz está dentro da meta.",
        iteracoes: 3,
        bloqueiosVerificador: 1,
        detalhesVerificador: [{ tentativa: 1, numeros: ["99,9%"] }],
        tokensEntrada: 1000,
        tokensSaida: 100,
        custoEstimadoMicrodolares: 10,
        latenciaMs: 800,
      })
      .returning({ id: schema.execucaoAgente.id });
    execucaoId = exec!.id;
    await db.insert(schema.chamadaFerramenta).values([
      {
        execucaoId,
        comercianteId: a,
        ordem: 2,
        ferramenta: "get_product_margin",
        entrada: { produto: "arroz" },
        saida: { margem_bps: 1800 },
        latenciaMs: 12,
      },
      {
        execucaoId,
        comercianteId: a,
        ordem: 1,
        ferramenta: "get_daily_summary",
        entrada: {},
        saida: { vendas: 3 },
        latenciaMs: 9,
      },
    ]);
    await db.insert(schema.alerta).values({
      comercianteId: a,
      tipo: "reajuste_de_custo",
      prioridade: 1,
      status: "enviado",
      dataReferencia: "2026-10-20",
      chave: "arroz",
      metricasApoio: { variacao_bps: 1205 },
      justificativa: "Maior variação do dia",
      execucaoId,
    });

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
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, [a, b]));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("a página é servida sem sessão e o painel exige sessão", async () => {
    const r = await request(servidor()).get("/bastidores").expect(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
    await request(servidor()).get("/bastidores/painel").expect(401);
  });

  it("mostra a execução com as chamadas em ordem, o verificador e a mensagem final", async () => {
    const p = await painel(a);
    const e = p.execucoes.find((x) => x.id === execucaoId)!;
    expect(e.chamadas.map((c) => [c.ordem, c.ferramenta])).toEqual([
      [1, "get_daily_summary"],
      [2, "get_product_margin"],
    ]);
    expect(e.chamadas[1]!.entrada).toEqual({ produto: "arroz" });
    expect(e.chamadas[1]!.saida).toEqual({ margem_bps: 1800 });
    expect(e.verificador.bloqueios).toBe(1);
    expect(e.verificador.tentativas[0]!.numeros).toEqual(["99,9%"]);
    expect(e.mensagem_final).toContain("margem do arroz");
  });

  it("mostra o candidato a alerta com a justificativa, ligado à execução", async () => {
    const p = await painel(a);
    const e = p.execucoes.find((x) => x.id === execucaoId)!;
    expect(e.decisoes_alerta).toHaveLength(1);
    expect(e.decisoes_alerta[0]).toMatchObject({
      tipo: "reajuste_de_custo",
      status: "enviado",
      justificativa: "Maior variação do dia",
    });
  });

  it("a versão do painel muda quando a decisão de um alerta muda sem execução nova", async () => {
    const antes = await painel(a);
    expect((await painel(a)).versao).toBe(antes.versao);
    await db
      .update(schema.alerta)
      .set({ justificativa: "Reajuste confirmado pelo dono" })
      .where(and(eq(schema.alerta.comercianteId, a), eq(schema.alerta.chave, "arroz")));
    const depois = await painel(a);
    expect(depois.versao).not.toBe(antes.versao);
    const e = depois.execucoes.find((x) => x.id === execucaoId)!;
    expect(e.decisoes_alerta[0]!.justificativa).toBe("Reajuste confirmado pelo dono");
    await db
      .update(schema.alerta)
      .set({ justificativa: "Maior variação do dia" })
      .where(and(eq(schema.alerta.comercianteId, a), eq(schema.alerta.chave, "arroz")));
  });

  it("um comerciante não vê as execuções, nem os alertas do outro", async () => {
    const p = await painel(b);
    expect(p.execucoes).toEqual([]);
    expect(p.decisoes_sem_execucao).toEqual([]);
    expect(p.ultima_nota).toBeNull();
  });

  it("mostra a última nota com a confiança de cada item e destaca a que fica abaixo do limite", async () => {
    await request(servidor())
      .post("/chat/notas")
      .set("X-Comerciante-Id", a)
      .attach("arquivo", readFileSync("fixtures/notas/nota-01.jpg"), {
        filename: "nota-01.jpg",
        contentType: "image/jpeg",
      })
      .expect(202);
    const limite = Date.now() + 15_000;
    let p = await painel(a);
    while ((!p.ultima_nota || p.ultima_nota.itens.length === 0) && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 100));
      p = await painel(a);
    }
    const nota = p.ultima_nota!;
    expect(nota.itens.length).toBeGreaterThan(0);
    expect(nota.itens.every((i) => !i.abaixo_do_limite)).toBe(true);
    expect(Number.isInteger(nota.total_centavos)).toBe(true);

    // Com a confiança de um item abaixo do limite, ele aparece destacado.
    const [item] = await db
      .select({ id: schema.itemDeCompra.id })
      .from(schema.itemDeCompra)
      .where(
        and(eq(schema.itemDeCompra.comercianteId, a), eq(schema.itemDeCompra.ordem, nota.itens[0]!.ordem)),
      )
      .limit(1);
    await db.update(schema.itemDeCompra).set({ confianca: 0.5 }).where(eq(schema.itemDeCompra.id, item!.id));
    const depois = (await painel(a)).ultima_nota!;
    expect(depois.itens[0]!.abaixo_do_limite).toBe(true);
    expect(depois.itens[1]!.abaixo_do_limite).toBe(false);
  });
});
