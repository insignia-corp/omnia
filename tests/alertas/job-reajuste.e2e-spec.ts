import { readFileSync } from "node:fs";
import { Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import { Pool } from "pg";
import { FILA_REAJUSTE, FilaReajuste } from "../../src/alertas/jobs/fila-reajuste";
import { VerificadorDeReajuste } from "../../src/alertas/jobs/verificar-reajuste";
import { fonteDeLimitesPadrao } from "../../src/alertas/limites";
import { MotorDeAlertas } from "../../src/alertas/motor-de-alertas";
import { RepositorioAlertasPostgres } from "../../src/alertas/repositorio-alertas";
import { carregarEnv } from "../../src/config/env";
import { FILA_EXTRACAO, FilaExtracao, type AposExtracao } from "../../src/ingestao/fila/fila-extracao";
import type { ProcessadorExtracao } from "../../src/ingestao/processador-extracao";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { MetricasService } from "../../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../../src/metricas/repositorio-metricas";

/**
 * Issues #45 e #46: o job de reajuste depois de cada nota processada e a detecção dos reajustes
 * plantados nos fixtures, sem falso alarme. Usa PostgreSQL e Redis reais.
 */

interface NaoDispara {
  tipo: string;
  produto_id?: string;
  fornecedor_id?: string;
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  parametros: { data_referencia: string };
  fornecedores: Array<{ id: string; nome: string }>;
  alertas_esperados: Array<{ tipo: string; produto_id: string | null; fornecedor_id?: string }>;
  alertas_que_nao_devem_disparar: NaoDispara[];
};
const REF = gabarito.parametros.data_referencia;

const esperar = async (condicao: () => Promise<boolean>, ms = 15_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Tempo esgotado esperando a condição");
};

describe("job de reajuste após cada nota (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const motor = new MotorDeAlertas(
    new MetricasService(new RepositorioMetricasPostgres(db)),
    new RepositorioAlertasPostgres(db),
    fonteDeLimitesPadrao,
  );
  const verificador = new VerificadorDeReajuste(db, motor, () => REF);
  const filaReajuste = new FilaReajuste(redis, verificador);
  const filasDeExtracao: FilaExtracao[] = [];
  const contagemReajuste = new Queue(FILA_REAJUSTE, { connection: redis });

  let vilaNova: string;
  let esquina: string;
  const skuPorProduto = new Map<string, string>();
  const gabaritoPorFornecedor = new Map<string, string>();
  let compras: Array<{ compraId: string; documentoId: string; data: string; fornecedorId: string }>;

  const reajustes = (comercianteId: string) =>
    db
      .select()
      .from(schema.alerta)
      .where(
        and(eq(schema.alerta.comercianteId, comercianteId), eq(schema.alerta.tipo, "reajuste_de_custo")),
      );
  const chaveDe = (l: { produtoId: string | null; fornecedorId: string | null }): string =>
    `${skuPorProduto.get(l.produtoId ?? "") ?? "?"}|${gabaritoPorFornecedor.get(l.fornecedorId ?? "") ?? "?"}`;

  /** Uma fila de extração com processador falso que só devolve a compra do documento. */
  function criarFilaDeExtracao(gancho: AposExtracao | undefined) {
    const processar = jest.fn((entrada: { documentoId: string; comercianteId: string }) => {
      const compra = compras.find((c) => c.documentoId === entrada.documentoId);
      return Promise.resolve({ status: "extraido" as const, compraId: compra?.compraId ?? "" });
    });
    const fila = new FilaExtracao(redis, { processar } as unknown as ProcessadorExtracao, gancho);
    fila.onModuleInit();
    filasDeExtracao.push(fila);
    return { fila, processar };
  }
  const fecharFilasDeExtracao = async () => {
    for (const f of filasDeExtracao.splice(0)) await f.onModuleDestroy();
  };

  /** Documentos que nenhum outro teste enfileira na fila de extração, escolhidos pela data, não pela ordem. */
  const documentoLivre = (indice: number): string => {
    const usado = new Set([docDaNota("2026-10-16", "AUR"), docDaNota("2026-10-13", "AUR")]);
    const livres = compras
      .filter((c) => !usado.has(c.documentoId))
      .sort((a, b) => a.data.localeCompare(b.data));
    const escolhida = livres[indice];
    if (!escolhida) throw new Error("Sem documento livre");
    return escolhida.documentoId;
  };

  const docDaNota = (data: string, fornecedorGabarito: string): string => {
    const c = compras.find(
      (x) => x.data === data && gabaritoPorFornecedor.get(x.fornecedorId) === fornecedorGabarito,
    );
    if (!c) throw new Error(`Sem compra de ${fornecedorGabarito} em ${data}`);
    return c.documentoId;
  };

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    const resumo = await semear(db);
    const idDe = (nome: string): string => {
      const linha = resumo.find((r) => r.comerciante === nome);
      if (!linha) throw new Error(`Comerciante ${nome} não está no seed`);
      return linha.comercianteId;
    };
    vilaNova = idDe("Mercadinho Vila Nova");
    esquina = idDe("Conveniência Esquina 24h");
    for (const p of await db
      .select({ id: schema.produto.id, sku: schema.produto.sku })
      .from(schema.produto)
      .where(eq(schema.produto.comercianteId, vilaNova))) {
      if (p.sku) skuPorProduto.set(p.id, p.sku);
    }
    const fornecedores = await db
      .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.comercianteId, vilaNova));
    for (const f of gabarito.fornecedores) {
      const linha = fornecedores.find((x) => x.nome === f.nome);
      if (linha) gabaritoPorFornecedor.set(linha.id, f.id);
    }
    compras = (
      await db
        .select({
          compraId: schema.compra.id,
          documentoId: schema.compra.documentoId,
          data: schema.compra.data,
          fornecedorId: schema.compra.fornecedorId,
        })
        .from(schema.compra)
        .where(eq(schema.compra.comercianteId, vilaNova))
    ).flatMap((c) => (c.documentoId ? [{ ...c, documentoId: c.documentoId }] : []));
    await redis.flushdb();
    filaReajuste.onModuleInit();
  });

  afterAll(async () => {
    await fecharFilasDeExtracao();
    await filaReajuste.onModuleDestroy();
    await contagemReajuste.close();
    await redis.quit();
    await pool.end();
  });

  describe("#45: job disparado ao final da extração", () => {
    it("processar a segunda nota do reajuste plantado gera o candidato", async () => {
      const { fila } = criarFilaDeExtracao((nota) => filaReajuste.enfileirar(nota));
      await fila.enfileirar({ documentoId: docDaNota("2026-10-16", "AUR"), comercianteId: vilaNova });
      await esperar(async () => (await reajustes(vilaNova)).length > 0);
      const [alerta] = await reajustes(vilaNova);
      expect(alerta).toMatchObject({
        status: "candidato",
        comercianteId: vilaNova,
        dataReferencia: REF,
        metricasApoio: { variacao_bps: 1205, custo_anterior_centavos: 2490, custo_atual_centavos: 2790 },
      });
      expect(chaveDe(alerta!)).toBe("P01|AUR");
      await fecharFilasDeExtracao();
    });

    it("o mesmo documento duas vezes vira um job e um candidato (idempotência por documento)", async () => {
      const espiao = jest.spyOn(verificador, "verificar");
      const documentoId = docDaNota("2026-10-13", "AUR");
      await filaReajuste.enfileirar({ documentoId, comercianteId: vilaNova });
      await filaReajuste.enfileirar({ documentoId, comercianteId: vilaNova });
      await esperar(async () => (await reajustes(vilaNova)).length === 2);
      await esperar(
        async () => (await contagemReajuste.getJobCounts("active", "waiting", "delayed")).active === 0,
      );
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(espiao).toHaveBeenCalledWith({ documentoId, comercianteId: vilaNova });
      expect((await reajustes(vilaNova)).map(chaveDe).sort()).toEqual(["P01|AUR", "P03|AUR"]);
      // Rodar o verificador de novo, direto, também não duplica: a unique do banco segura.
      const outra = await verificador.verificar({ documentoId, comercianteId: vilaNova });
      expect(outra.gravados).toBe(0);
      expect(await reajustes(vilaNova)).toHaveLength(2);
      espiao.mockRestore();
    });

    it("o mesmo documento verificado em outro dia não grava o mesmo reajuste de novo", async () => {
      const documentoId = docDaNota("2026-10-16", "AUR");
      const antes = await reajustes(vilaNova);
      expect(antes.some((l) => chaveDe(l) === "P01|AUR")).toBe(true);
      const r = await verificador.verificar({ documentoId, comercianteId: vilaNova }, "2026-10-20");
      expect(r.gravados).toBe(0);
      expect(await reajustes(vilaNova)).toHaveLength(antes.length);
    });

    it("o comerciante é o do job: documento de um lojista com o id de outro não grava nada", async () => {
      const documentoId = docDaNota("2026-10-16", "AUR");
      const antes = await reajustes(esquina);
      const r = await verificador.verificar({ documentoId, comercianteId: esquina });
      expect(r).toEqual({ produtos: 0, gravados: 0 });
      expect(await reajustes(esquina)).toEqual(antes);
    });

    it("falha do gancho é registrada com o documento e não falha nem repete a extração", async () => {
      const erro = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      const gancho = jest.fn(() => Promise.reject(new Error("redis fora")));
      const { fila, processar } = criarFilaDeExtracao(gancho);
      // Documento próprio deste teste (o do primeiro já passou pela fila de extração: jobId não repete).
      const fila2Doc = documentoLivre(0);
      await fila.enfileirar({ documentoId: fila2Doc, comercianteId: vilaNova });
      await esperar(() => Promise.resolve(gancho.mock.calls.length > 0));
      const contagem = new Queue(FILA_EXTRACAO, { connection: redis });
      await esperar(
        async () => (await (await contagem.getJob(`${vilaNova}_${fila2Doc}`))?.getState()) === "completed",
      );
      expect(await contagem.getJobCounts("failed", "delayed", "waiting")).toMatchObject({
        failed: 0,
        delayed: 0,
        waiting: 0,
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(processar).toHaveBeenCalledTimes(1);
      expect(gancho).toHaveBeenCalledTimes(1);
      expect(erro).toHaveBeenCalledWith(expect.stringContaining(fila2Doc));
      expect(erro).toHaveBeenCalledWith(expect.stringContaining("redis fora"));
      await contagem.close();
      erro.mockRestore();
      await fecharFilasDeExtracao();
    });

    it("sem o gancho, a fila de extração segue funcionando como antes", async () => {
      const { fila, processar } = criarFilaDeExtracao(undefined);
      // Outro documento, também só deste teste.
      const documentoId = documentoLivre(1);
      await fila.enfileirar({ documentoId, comercianteId: vilaNova });
      await esperar(() => Promise.resolve(processar.mock.calls.length > 0));
      expect(processar).toHaveBeenCalledWith({ documentoId, comercianteId: vilaNova }, expect.any(Boolean));
      await fecharFilasDeExtracao();
    });
  });

  describe("#46: reajustes plantados, sem falso alarme", () => {
    beforeAll(async () => {
      await db.delete(schema.alerta).where(eq(schema.alerta.comercianteId, vilaNova));
    });

    it("rodando o verificador em cada nota, na data dela, só os 2 reajustes plantados viram candidato", async () => {
      expect(compras).toHaveLength(18);
      for (const c of compras) {
        await verificador.verificar({ documentoId: c.documentoId, comercianteId: vilaNova }, c.data);
      }
      const esperados = gabarito.alertas_esperados
        .filter((a) => a.tipo === "reajuste_de_custo")
        .map((a) => `${a.produto_id}|${a.fornecedor_id}`)
        .sort();
      expect(esperados).toEqual(["P01|AUR", "P03|AUR"]);
      const linhas = await reajustes(vilaNova);
      expect(linhas.map(chaveDe).sort()).toEqual(esperados);
      expect(linhas).toHaveLength(2);
    });

    it("açúcar +3,87%, cerveja +1,57%, café em queda e arroz do outro fornecedor ficam fora", async () => {
      const gravados = new Set((await reajustes(vilaNova)).map(chaveDe));
      const casos = gabarito.alertas_que_nao_devem_disparar.filter((n) => n.tipo === "reajuste_de_custo");
      expect(casos).toHaveLength(4);
      for (const n of casos) expect(gravados.has(`${n.produto_id}|${n.fornecedor_id}`)).toBe(false);
    });

    it("reajustes de vários tamanhos: 12,05% e 7,69% passam; 3,87% e 1,57% não", async () => {
      const linhas = await reajustes(vilaNova);
      const bps = linhas
        .map((l) => (l.metricasApoio as { variacao_bps: number }).variacao_bps)
        .sort((a, b) => a - b);
      expect(bps).toEqual([769, 1205]);
    });
  });
});
