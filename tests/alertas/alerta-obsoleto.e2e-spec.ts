import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { criarSelectAlerts } from "../../src/agente/ferramentas/select-alerts";
import { fonteDeLimitesPadrao } from "../../src/alertas/limites";
import { MotorDeAlertas } from "../../src/alertas/motor-de-alertas";
import { RepositorioAlertasPostgres } from "../../src/alertas/repositorio-alertas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { MetricasService } from "../../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../../src/metricas/repositorio-metricas";

/**
 * Issue #157: o candidato do dia que a regra deixa de disparar depois de uma correção do dono vira
 * `obsoleto` (e some do select_alerts e dos candidatos), os números de quem continua valendo são
 * atualizados, e o mesmo reajuste sob outra chave, já tratado, não volta.
 */
describe("alerta obsoleto (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  const motor = new MotorDeAlertas(
    new MetricasService(new RepositorioMetricasPostgres(db)),
    new RepositorioAlertasPostgres(db),
    fonteDeLimitesPadrao,
  );
  const REF = "2026-10-19";

  let vilaNova: string;
  let esquina: string;
  let arroz: string;
  let aurora: string;
  let itemDoArroz: string;
  const ctx = () => ({ comercianteId: vilaNova, nomeComercio: "Vila Nova", dataReferencia: REF });

  const doProduto = async (tipo: "reajuste_de_custo" | "margem_abaixo_da_meta") => {
    const linhas = await db
      .select()
      .from(schema.alerta)
      .where(
        and(
          eq(schema.alerta.comercianteId, vilaNova),
          eq(schema.alerta.dataReferencia, REF),
          eq(schema.alerta.produtoId, arroz),
          eq(schema.alerta.tipo, tipo),
        ),
      );
    return linhas;
  };

  /** A correção do dono: uma nova leitura do custo do item da nota, que vale por ser a mais recente. */
  const corrigirCusto = (custoUnitarioCentavos: number) =>
    db.insert(schema.historicoCusto).values({
      comercianteId: vilaNova,
      produtoId: arroz,
      fornecedorId: aurora,
      data: "2026-10-16",
      custoUnitarioCentavos,
      itemDeCompraId: itemDoArroz,
      origem: "dono",
      confianca: 1,
    });

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    const resumo = await semear(db);
    const idDe = (nome: string): string => {
      const r = resumo.find((x) => x.comerciante === nome);
      if (!r) throw new Error(`Comerciante ${nome} não está no seed`);
      return r.comercianteId;
    };
    vilaNova = idDe("Mercadinho Vila Nova");
    esquina = idDe("Conveniência Esquina 24h");
    const [p] = await db
      .select({ id: schema.produto.id })
      .from(schema.produto)
      .where(and(eq(schema.produto.comercianteId, vilaNova), eq(schema.produto.sku, "P01")));
    arroz = p!.id;
    const [f] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(
        and(
          eq(schema.fornecedor.comercianteId, vilaNova),
          eq(schema.fornecedor.nome, "Distribuidora Aurora Alimentos Ltda"),
        ),
      );
    aurora = f!.id;
    const [item] = await db
      .select({ id: schema.itemDeCompra.id })
      .from(schema.itemDeCompra)
      .innerJoin(schema.compra, eq(schema.compra.id, schema.itemDeCompra.compraId))
      .where(
        and(
          eq(schema.itemDeCompra.comercianteId, vilaNova),
          eq(schema.itemDeCompra.produtoId, arroz),
          eq(schema.compra.data, "2026-10-16"),
          eq(schema.compra.fornecedorId, aurora),
        ),
      );
    itemDoArroz = item!.id;
  });
  afterAll(() => pool.end());

  describe("o mesmo reajuste sob outra chave, já tratado, não volta", () => {
    it("alerta enviado do mesmo produto, fornecedor e custos sob outra chave suprime o reajuste", async () => {
      await db.insert(schema.alerta).values({
        comercianteId: vilaNova,
        tipo: "reajuste_de_custo",
        prioridade: 2,
        status: "enviado",
        dataReferencia: "2026-10-17",
        chave: `${arroz}:${aurora}:compra-de-antes-da-correcao`,
        produtoId: arroz,
        fornecedorId: aurora,
        metricasApoio: { custo_atual_centavos: 2790, custo_anterior_centavos: 2490 },
      });
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.candidatos.some((c) => c.tipo === "reajuste_de_custo" && c.produtoId === arroz)).toBe(false);
      expect(r.suprimidos.some((c) => c.tipo === "reajuste_de_custo" && c.produtoId === arroz)).toBe(true);
    });

    it("só dentro de 7 dias: o mesmo movimento tratado há 8 dias pode alertar de novo", async () => {
      await db
        .update(schema.alerta)
        .set({ dataReferencia: "2026-10-11" })
        .where(and(eq(schema.alerta.comercianteId, vilaNova), eq(schema.alerta.status, "enviado")));
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.candidatos.some((c) => c.tipo === "reajuste_de_custo" && c.produtoId === arroz)).toBe(true);
    });
  });

  describe("correção do dono", () => {
    it("o candidato que a regra deixou de disparar vira obsoleto, sai dos candidatos e do select_alerts, e a linha fica", async () => {
      const antes = await doProduto("reajuste_de_custo");
      const margemAntes = await doProduto("margem_abaixo_da_meta");
      expect(antes).toHaveLength(1);
      expect(margemAntes).toHaveLength(1);
      // O custo corrigido para R$ 25,00 (0,4% sobre os R$ 24,90): não é mais reajuste, e a margem passa da meta.
      await corrigirCusto(2500);
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.obsoletos).toBeGreaterThanOrEqual(2);
      expect((await doProduto("reajuste_de_custo"))[0]?.status).toBe("obsoleto");
      expect((await doProduto("margem_abaixo_da_meta"))[0]?.status).toBe("obsoleto");
      expect(r.candidatos.some((c) => c.produtoId === arroz && c.tipo === "reajuste_de_custo")).toBe(false);
      // A linha continua lá (nada é apagado) e o agente não pode escolhê-la.
      await expect(
        criarSelectAlerts(db).executar(ctx(), { alertas: [{ alerta_id: antes[0]!.id, justificativa: "x" }] }),
      ).rejects.toThrow(/candidatos de hoje/);
    });

    it("repetir sem mudança não grava nem marca nada", async () => {
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.gravados).toBe(0);
      expect(r.obsoletos).toBe(0);
    });

    it("quem continua valendo tem os números atualizados, sem duplicar a linha", async () => {
      // Outra correção: o custo volta a subir (R$ 28,00), o reajuste dispara de novo com custo novo 2800.
      await corrigirCusto(2800);
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.gravados).toBeGreaterThan(0);
      const linhas = await doProduto("reajuste_de_custo");
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ status: "candidato" });
      expect(linhas[0]?.metricasApoio).toMatchObject({
        custo_atual_centavos: 2800,
        custo_anterior_centavos: 2490,
      });
      // Uma nova correção que só muda o valor (R$ 28,50) atualiza o mesmo candidato.
      await corrigirCusto(2850);
      await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      const depois = await doProduto("reajuste_de_custo");
      expect(depois).toHaveLength(1);
      expect(depois[0]?.metricasApoio).toMatchObject({ custo_atual_centavos: 2850 });
    });

    it("o obsoleto que volta a valer é reativado como candidato", async () => {
      // Primeiro o custo corrigido para R$ 25,00: a margem passa da meta e o candidato vira obsoleto.
      await corrigirCusto(2500);
      await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect((await doProduto("margem_abaixo_da_meta"))[0]?.status).toBe("obsoleto");
      // Volta ao custo de R$ 27,90 do seed: a margem fica abaixo da meta de novo.
      await corrigirCusto(2790);
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      const margem = await doProduto("margem_abaixo_da_meta");
      expect(margem).toHaveLength(1);
      expect(margem[0]?.status).toBe("candidato");
      expect(r.candidatos.some((c) => c.id === margem[0]?.id)).toBe(true);
    });

    it("enviado e descartado nunca são tocados pela correção", async () => {
      const [alvo] = await doProduto("reajuste_de_custo");
      await db.update(schema.alerta).set({ status: "enviado" }).where(eq(schema.alerta.id, alvo!.id));
      await corrigirCusto(2500);
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      const [depois] = await doProduto("reajuste_de_custo");
      expect(depois).toMatchObject({ id: alvo!.id, status: "enviado", metricasApoio: alvo!.metricasApoio });
      expect(r.candidatos.some((c) => c.id === alvo!.id)).toBe(false);
    });
  });

  describe("isolamento entre lojistas", () => {
    it("a correção e o motor de um lojista não marcam nada do outro", async () => {
      const antes = await db.select().from(schema.alerta).where(eq(schema.alerta.comercianteId, esquina));
      await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      const depois = await db.select().from(schema.alerta).where(eq(schema.alerta.comercianteId, esquina));
      expect(depois).toEqual(antes);
      await motor.executar({ comercianteId: esquina, dataReferencia: REF });
      const vila = await doProduto("reajuste_de_custo");
      expect(vila[0]?.comercianteId).toBe(vilaNova);
    });
  });
});
