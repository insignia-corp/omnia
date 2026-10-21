import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { mkdirSync, mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { resetarDemo } from "../../scripts/demo/resetar-demo";
import { FILA_RELATORIO_DIARIO } from "../../src/canal/jobs/fila-relatorio-diario";
import { carregarEnv } from "../../src/config/env";
import { FILA_EXTRACAO } from "../../src/ingestao/fila/fila-extracao";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { carregarFixtures } from "../../src/infra/database/seed/carregar-fixtures";
import { comerciantesDoSeed } from "../../src/infra/database/seed/semear";
import { montarSeed } from "../../src/infra/database/seed/montar-seed";

/** Regra inviolável 10: o reset da demo recria só os comerciantes da demo e nunca mexe nos outros. */
describe("reset da demo (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-reset-"));
  const env = { ...carregarEnv(), ARMAZENAMENTO_DIR: dirArquivos };
  const idDemo = montarSeed(
    comerciantesDoSeed(carregarFixtures())[0]!.dados,
    comerciantesDoSeed(carregarFixtures())[0]!.opcoes,
  ).comerciante.id as string;

  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let redis: Redis;
  let fila: Queue;
  let real = "";

  const contar = async (tabela: string, comerciante: string) => {
    const r = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(tabela)} where comerciante_id = ${comerciante}`,
    );
    return r.rows[0]!.n;
  };
  const retrato = async (comerciante: string) =>
    Object.fromEntries(
      await Promise.all(
        [
          "produto",
          "fornecedor",
          "compra",
          "item_de_compra",
          "venda",
          "item_de_venda",
          "historico_custo",
        ].map(async (t) => [t, await contar(t, comerciante)] as const),
      ),
    );

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    fila = new Queue(FILA_RELATORIO_DIARIO, { connection: redis });
    const [c] = await db
      .insert(schema.comerciante)
      .values({ nome: "E2E Reset comerciante real" })
      .returning({ id: schema.comerciante.id });
    real = c!.id;
    await db.insert(schema.produto).values({ comercianteId: real, nome: "Produto real", origem: "dono" });
  });

  afterAll(async () => {
    await fila.close();
    await redis.quit();
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, real));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("duas execuções seguidas dão o mesmo estado, e o que a demo gerou some", async () => {
    await resetarDemo(env, redis);
    // Uso da demo: mensagem gravada, arquivo enviado e job do dia concluído.
    await db.insert(schema.mensagem).values({
      comercianteId: idDemo,
      direcao: "recebida",
      texto: "teste",
      dataEnvio: "2026-10-20",
      idExterno: "reset-1",
    });
    mkdirSync(join(dirArquivos, idDemo), { recursive: true });
    writeFileSync(join(dirArquivos, idDemo, "foto.jpg"), "x");
    await fila.add(
      "processar",
      { comercianteId: idDemo, data: "2026-10-20" },
      { jobId: `relatorio_${idDemo}_2026-10-20`, delay: 3_600_000 },
    );
    await fila.add(
      "processar",
      { comercianteId: real, data: "2026-10-20" },
      { jobId: `relatorio_${real}_2026-10-20`, delay: 3_600_000 },
    );

    const primeiro = await resetarDemo(env, redis);
    const retratoUm = await retrato(idDemo);
    const segundo = await resetarDemo(env, redis);
    const retratoDois = await retrato(idDemo);

    expect(retratoDois).toEqual(retratoUm);
    expect(primeiro.comerciantes[0]!.comercianteId).toBe(idDemo);
    expect(segundo.comerciantes[0]!.comercianteId).toBe(idDemo);
    expect(retratoUm.venda).toBeGreaterThan(0);

    expect(await contar("mensagem", idDemo)).toBe(0);
    expect(existsSync(join(dirArquivos, idDemo))).toBe(false);
    expect(await fila.getJob(`relatorio_${idDemo}_2026-10-20`)).toBeUndefined();
    expect(await fila.getJob(`relatorio_${real}_2026-10-20`)).toBeDefined();
    await fila.remove(`relatorio_${real}_2026-10-20`);

    // O comerciante que não é da demo continua intacto.
    expect(await contar("produto", real)).toBe(1);
  });

  it("com um job da demo em execução, espera ele terminar ou falha antes de mexer no banco", async () => {
    await resetarDemo(env, redis);
    let soltar = () => {};
    const preso = new Promise<void>((r) => (soltar = r));
    let ativo = () => {};
    const comecou = new Promise<void>((r) => (ativo = r));
    const conexaoWorker = redis.duplicate();
    const filaExtracao = new Queue(FILA_EXTRACAO, { connection: redis });
    const worker = new Worker(
      FILA_RELATORIO_DIARIO,
      async () => {
        ativo();
        await preso;
      },
      { connection: conexaoWorker },
    );
    try {
      await fila.add(
        "processar",
        { comercianteId: idDemo, data: "2026-10-21" },
        { jobId: `relatorio_${idDemo}_2026-10-21` },
      );
      await comecou;
      // Jobs pendentes da demo: não podem sumir se o reset desistir (sem worker na fila de extração).
      await filaExtracao.add(
        FILA_EXTRACAO,
        { comercianteId: idDemo, documentoId: "doc-e2e" },
        { jobId: `${idDemo}_doc-e2e` },
      );
      await fila.add(
        "processar",
        { comercianteId: idDemo, data: "2026-10-22" },
        { jobId: `relatorio_${idDemo}_2026-10-22`, delay: 3_600_000 },
      );
      await db.insert(schema.mensagem).values({
        comercianteId: idDemo,
        direcao: "recebida",
        texto: "durante o job",
        dataEnvio: "2026-10-21",
        idExterno: "reset-ativo",
      });

      // Sem esperar o bastante, o reset desiste e o banco fica como estava.
      await expect(resetarDemo(env, redis, { esperaMaximaMs: 300, intervaloMs: 50 })).rejects.toThrow(
        /em execução/,
      );
      expect(await contar("mensagem", idDemo)).toBe(1);
      const pendente = await filaExtracao.getJob(`${idDemo}_doc-e2e`);
      expect(pendente).toBeDefined();
      expect(await pendente!.getState()).toBe("waiting");
      expect(await fila.getJob(`relatorio_${idDemo}_2026-10-22`)).toBeDefined();
      expect(await fila.isPaused()).toBe(false);
      expect(await filaExtracao.isPaused()).toBe(false);

      // Quando o job termina durante a espera, o reset segue e o job concluído também sai da fila.
      setTimeout(soltar, 300);
      await resetarDemo(env, redis, { esperaMaximaMs: 10_000, intervaloMs: 50 });
      expect(await contar("mensagem", idDemo)).toBe(0);
      expect(await fila.getJob(`relatorio_${idDemo}_2026-10-21`)).toBeUndefined();
      expect(await filaExtracao.getJob(`${idDemo}_doc-e2e`)).toBeUndefined();
      expect(await fila.getJob(`relatorio_${idDemo}_2026-10-22`)).toBeUndefined();
      expect(await fila.isPaused()).toBe(false);
      expect(await filaExtracao.isPaused()).toBe(false);
    } finally {
      soltar();
      await worker.close();
      await conexaoWorker.quit();
      await filaExtracao.close();
    }
  });

  it("durante o reset o worker não pega job novo da demo", async () => {
    await resetarDemo(env, redis);
    let soltar = () => {};
    const preso = new Promise<void>((r) => (soltar = r));
    let ativo = () => {};
    const comecou = new Promise<void>((r) => (ativo = r));
    let chamadas = 0;
    const conexaoWorker = redis.duplicate();
    const worker = new Worker(
      FILA_RELATORIO_DIARIO,
      async () => {
        chamadas++;
        ativo();
        await preso;
      },
      { connection: conexaoWorker, concurrency: 2 },
    );
    try {
      await fila.add(
        "processar",
        { comercianteId: idDemo, data: "2026-10-22" },
        { jobId: `relatorio_${idDemo}_2026-10-22` },
      );
      await comecou;

      const reset = resetarDemo(env, redis, { esperaMaximaMs: 10_000, intervaloMs: 50 });
      while (!(await fila.isPaused())) await new Promise((r) => setTimeout(r, 20));
      await fila.add(
        "processar",
        { comercianteId: idDemo, data: "2026-10-23" },
        { jobId: `relatorio_${idDemo}_2026-10-23` },
      );
      await new Promise((r) => setTimeout(r, 200));
      const novo = await fila.getJob(`relatorio_${idDemo}_2026-10-23`);
      expect(novo).toBeDefined();
      expect(await novo!.getState()).not.toBe("active");
      expect(chamadas).toBe(1);

      soltar();
      await reset;
      expect(await fila.getJob(`relatorio_${idDemo}_2026-10-23`)).toBeUndefined();
      expect(chamadas).toBe(1);
      expect(await fila.isPaused()).toBe(false);
    } finally {
      soltar();
      await worker.close();
      await conexaoWorker.quit();
    }
  });
});
