import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { WhatsappController } from "../../src/canal/web/whatsapp.controller";
import { DB } from "../../src/infra/database/database.module";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { COMERCIANTE_PITCH, hashPitch } from "./dados";
import { semearPitch } from "./semear";

/** Banco temporário próprio: este teste nunca reseta o banco da demo ou dos outros e2e. */
describe("histórias do seed do pitch (e2e)", () => {
  const conexao = process.env.DATABASE_URL ?? "postgres://omnia:omnia@localhost:5432/omnia";
  const admin = new Pool({ connectionString: conexao, max: 1 });
  const nomeBanco = `omnia_pitch_e2e_${process.pid}`;
  let pool: Pool;
  let app: INestApplication<Server>;
  const anterior = process.env.DEMO_COMERCIANTE;

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE ${nomeBanco}`);
    const url = new URL(conexao);
    url.pathname = `/${nomeBanco}`;
    await migrar(url.toString());
    pool = new Pool({ connectionString: url.toString(), max: 3 });
    const db = drizzle(pool, { schema });
    await semearPitch(db);
    const modulo = await Test.createTestingModule({
      controllers: [WhatsappController],
      providers: [{ provide: DB, useValue: db }],
    }).compile();
    app = modulo.createNestApplication();
    await app.init();
  }, 30000);

  afterAll(async () => {
    if (anterior === undefined) delete process.env.DEMO_COMERCIANTE;
    else process.env.DEMO_COMERCIANTE = anterior;
    await app?.close();
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${nomeBanco}`);
    await admin.end();
  });

  it("só carrega o Bom Preço, sem contas, transações ou proativa já enviada", async () => {
    const { rows } = await pool.query("select id, nome, margem_meta_bps from comerciante");
    expect(rows).toEqual([{ id: COMERCIANTE_PITCH, nome: "Mercadinho Bom Preço", margem_meta_bps: 2500 }]);
    for (const tabela of ["conta", "transacao", "execucao_agente", "alerta"]) {
      // A remoção bancária corre em outra frente: tabela removida também significa nenhum dado bancário.
      const existe = await pool.query<{ tabela: string | null }>("select to_regclass($1)::text tabela", [
        tabela,
      ]);
      if (existe.rows[0]!.tabela === null) {
        expect(["conta", "transacao"]).toContain(tabela);
        continue;
      }
      expect((await pool.query<{ n: number }>(`select count(*)::int n from ${tabela}`)).rows[0]!.n).toBe(0);
    }
    expect((await pool.query<{ n: number }>("select count(*)::int n from produto")).rows[0]!.n).toBe(29);
    expect(
      (await pool.query<{ n: number }>("select count(*)::int n from mensagem where proativa")).rows[0]!.n,
    ).toBe(0);
    const m = (
      await pool.query<{ texto: string; janela: boolean }>(
        "select texto, criado_em > timestamptz '2026-10-24 12:00:00-03' - interval '24 hours' as janela from mensagem where direcao='recebida'",
      )
    ).rows[0]!;
    expect(m.texto).toContain("Seu João");
    expect(m.janela).toBe(true);
  });

  it("tem dados de todos os dias e sextas com os faturamentos e tickets do roteiro", async () => {
    const { rows } = await pool.query<{ data: string; receita: number; ticket: number }>(
      "select data::text, sum(total_centavos)::int receita, round(avg(total_centavos))::int ticket from venda group by data order by data",
    );
    expect(rows).toHaveLength(53);
    expect(rows[0]!.data).toBe("2026-09-01");
    expect(rows.at(-1)!.data).toBe("2026-10-23");
    const ultima = rows.at(-1)!;
    expect(ultima.receita).toBeGreaterThan(410000);
    expect(ultima.receita).toBeLessThan(425000);
    expect(ultima.ticket).toBeGreaterThan(2980);
    expect(ultima.ticket).toBeLessThan(3040);
    for (const data of ["2026-10-02", "2026-10-09", "2026-10-16"]) {
      const sexta = rows.find((r) => r.data === data)!;
      expect(sexta.receita).toBeGreaterThan(360000);
      expect(sexta.receita).toBeLessThan(380000);
      expect(sexta.ticket).toBeGreaterThan(2810);
      expect(sexta.ticket).toBeLessThan(2870);
    }
    const semana = (inicio: string, fim: string) =>
      rows.filter((r) => r.data >= inicio && r.data <= fim).reduce((s, r) => s + r.receita, 0);
    const crescimento = semana("2026-10-17", "2026-10-23") / semana("2026-10-10", "2026-10-16") - 1;
    expect(crescimento).toBeGreaterThan(0.035);
    expect(crescimento).toBeLessThan(0.045);
    // Setembro completo, aproximadamente R$ 90 mil, com ticket perto de R$ 28.
    const setembro = rows.filter((r) => r.data < "2026-10-01").reduce((s, r) => s + r.receita, 0);
    expect(setembro).toBeGreaterThan(8500000);
    expect(setembro).toBeLessThan(9500000);
  });

  it("planta os três líderes, as três quedas de 40 a 50% e a última venda do vinagre", async () => {
    const { rows } = await pool.query<{
      nome: string;
      sku: string;
      atual: number;
      anterior: number;
    }>(`select p.nome, p.sku,
      coalesce(sum(i.quantidade) filter (where v.data between '2026-10-17' and '2026-10-23'),0)::int atual,
      coalesce(sum(i.quantidade) filter (where v.data between '2026-10-10' and '2026-10-16'),0)::int anterior
      from produto p join item_de_venda i on i.produto_id=p.id and i.comerciante_id=p.comerciante_id
      join venda v on v.id=i.venda_id and v.comerciante_id=i.comerciante_id group by p.id order by atual desc, p.nome`);
    expect(rows.slice(0, 3).map((r) => r.sku)).toEqual(["cerveja", "leite", "agua"]);
    const quedas = rows
      .filter((r) => r.anterior >= 10)
      .sort((a, b) => a.atual / a.anterior - b.atual / b.anterior);
    expect(
      quedas
        .slice(0, 3)
        .map((r) => r.sku)
        .sort(),
    ).toEqual(["achocolatado", "biscoito", "sabao"]);
    for (const r of quedas.slice(0, 3)) {
      expect(1 - r.atual / r.anterior).toBeGreaterThanOrEqual(0.4);
      expect(1 - r.atual / r.anterior).toBeLessThanOrEqual(0.5);
    }
    for (const r of quedas.slice(3)) expect(Math.abs(r.atual / r.anterior - 1)).toBeLessThan(0.15);
    const ultima = await pool.query<{ data: string }>(
      "select max(v.data)::text data from venda v join item_de_venda i on i.venda_id=v.id join produto p on p.id=i.produto_id where p.sku='vinagre'",
    );
    expect(ultima.rows[0]!.data).toBe("2026-10-08");
  });

  it("fecha os cupons e conserva custos com origem, confiança e vínculos confirmados", async () => {
    const divergentes = await pool.query(
      "select v.id from venda v join item_de_venda i on i.venda_id=v.id group by v.id having sum(i.valor_total_centavos) <> v.total_centavos",
    );
    expect(divergentes.rowCount).toBe(0);
    const arroz = await pool.query(
      "select data::text, custo_unitario_centavos::int custo from historico_custo h join produto p on p.id=h.produto_id where p.sku='arroz' order by data",
    );
    expect(arroz.rows).toEqual([
      { data: "2026-09-01", custo: 2290 },
      { data: "2026-10-13", custo: 2290 },
      { data: "2026-10-20", custo: 2540 },
    ]);
    const cafe = await pool.query(
      "select distinct custo_unitario_centavos::int custo from historico_custo h join produto p on p.id=h.produto_id where p.sku='cafe'",
    );
    expect(cafe.rows).toEqual([{ custo: 1690 }]);
    expect(
      (
        await pool.query<{ n: number }>(
          "select count(*)::int n from historico_custo where origem is null or confianca <> 1",
        )
      ).rows[0]!.n,
    ).toBe(0);
    expect(
      (
        await pool.query<{ n: number }>(
          "select count(*)::int n from vinculo_descricao_produto where confirmado_pelo_dono and metodo='dono'",
        )
      ).rows[0]!.n,
    ).toBe(29);
    const hash = hashPitch(readFileSync(resolve(__dirname, "../../fixtures/pitch/danfe-video.jpg")));
    expect((await pool.query("select id from documento where arquivo_hash=$1", [hash])).rowCount).toBe(0);
  });

  it("seleciona Bom Preço pela variável sem alterar a prioridade do parâmetro explícito", async () => {
    process.env.DEMO_COMERCIANTE = "bom-preco";
    const padrao = await request(app.getHttpServer()).get("/whatsapp/sessao").expect(200);
    expect(padrao.body).toEqual({ comerciante_id: COMERCIANTE_PITCH, nome: "Mercadinho Bom Preço" });
    await request(app.getHttpServer()).get("/whatsapp/sessao?comerciante=invalido").expect(404);
    delete process.env.DEMO_COMERCIANTE;
    await request(app.getHttpServer()).get("/whatsapp/sessao").expect(404);
    await request(app.getHttpServer()).get(`/whatsapp/sessao?comerciante=${COMERCIANTE_PITCH}`).expect(200);
  });
});
