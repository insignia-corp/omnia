import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { fonteDeLimitesPadrao } from "../../src/alertas/limites";
import { MotorDeAlertas } from "../../src/alertas/motor-de-alertas";
import { RepositorioAlertasPostgres } from "../../src/alertas/repositorio-alertas";
import { criarSelectAlerts } from "../../src/agente/ferramentas/select-alerts";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { MetricasService } from "../../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../../src/metricas/repositorio-metricas";

/**
 * Critério de pronto das issues #43 e #44: rodar o motor no seed gera exatamente os candidatos do
 * gabarito, nenhum dos que não devem disparar, e o mesmo reajuste não volta na mesma semana.
 */

interface AlertaGabarito {
  tipo: string;
  produto_id: string | null;
  fornecedor_id?: string;
  metricas: Record<string, number | string>;
}

interface NaoDispara {
  tipo: string;
  produto_id?: string;
  fornecedor_id?: string;
  data?: string;
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  parametros: { data_referencia: string };
  fornecedores: Array<{ id: string; nome: string }>;
  alertas_esperados: AlertaGabarito[];
  alertas_que_nao_devem_disparar: NaoDispara[];
};
const REF = gabarito.parametros.data_referencia;

describe("motor de alertas contra o gabarito (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const repositorio = new RepositorioAlertasPostgres(db);
  const motor = new MotorDeAlertas(
    new MetricasService(new RepositorioMetricasPostgres(db)),
    repositorio,
    fonteDeLimitesPadrao,
  );

  let vilaNova: string;
  let esquina: string;
  const skuPorProduto = new Map<string, string>();
  const produtoPorSku = new Map<string, string>();
  const gabaritoPorFornecedor = new Map<string, string>();
  const fornecedorDoGabarito = new Map<string, string>();

  /** Identifica um alerta como o gabarito: tipo, produto (SKU) ou data, e fornecedor. */
  const chaveDoGabarito = (tipo: string, produto: string | null | undefined, fornecedor?: string): string =>
    [tipo, produto ?? REF, fornecedor ?? ""].join("|");

  const linhasDoBanco = (comercianteId: string) =>
    db.select().from(schema.alerta).where(eq(schema.alerta.comercianteId, comercianteId));

  beforeAll(async () => {
    await migrar(url);
    const resumo = await semear(db);
    const idDe = (nome: string): string => {
      const linha = resumo.find((r) => r.comerciante === nome);
      if (!linha) throw new Error(`Comerciante ${nome} não está no seed`);
      return linha.comercianteId;
    };
    vilaNova = idDe("Mercadinho Vila Nova");
    esquina = idDe("Conveniência Esquina 24h");

    const produtos = await db
      .select({ id: schema.produto.id, sku: schema.produto.sku })
      .from(schema.produto)
      .where(eq(schema.produto.comercianteId, vilaNova));
    for (const p of produtos) {
      if (!p.sku) continue;
      skuPorProduto.set(p.id, p.sku);
      produtoPorSku.set(p.sku, p.id);
    }
    const fornecedores = await db
      .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.comercianteId, vilaNova));
    for (const f of gabarito.fornecedores) {
      const linha = fornecedores.find((x) => x.nome === f.nome);
      if (!linha) continue;
      gabaritoPorFornecedor.set(f.id, linha.id);
      fornecedorDoGabarito.set(linha.id, f.id);
    }
  });
  afterAll(() => pool.end());

  const chaveDaLinha = (l: { tipo: string; produtoId: string | null; fornecedorId: string | null }) =>
    chaveDoGabarito(
      l.tipo,
      l.produtoId ? skuPorProduto.get(l.produtoId) : null,
      l.fornecedorId ? fornecedorDoGabarito.get(l.fornecedorId) : undefined,
    );

  describe("candidatos do dia de referência (#43)", () => {
    it("o motor no seed gera exatamente os candidatos do gabarito", async () => {
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      const obtidos = r.candidatos.map(chaveDaLinha).sort();
      const esperados = gabarito.alertas_esperados
        .map((a) => chaveDoGabarito(a.tipo, a.produto_id, a.fornecedor_id))
        .sort();
      expect(esperados).toHaveLength(16);
      expect(obtidos).toEqual(esperados);
      expect(r.gravados).toBe(16);
      expect(r.suprimidos).toEqual([]);
    });

    it("grava como candidato, com os números do gabarito nas métricas de apoio", async () => {
      const linhas = await linhasDoBanco(vilaNova);
      expect(linhas).toHaveLength(16);
      for (const esperado of gabarito.alertas_esperados) {
        const chave = chaveDoGabarito(esperado.tipo, esperado.produto_id, esperado.fornecedor_id);
        const linha = linhas.find((l) => chaveDaLinha(l) === chave);
        expect(linha).toMatchObject({ status: "candidato", dataReferencia: REF });
        expect(linha?.metricasApoio).toMatchObject(esperado.metricas);
      }
    });

    it("nenhum dos casos que não devem disparar vira candidato", async () => {
      const gravados = new Set((await linhasDoBanco(vilaNova)).map(chaveDaLinha));
      for (const n of gabarito.alertas_que_nao_devem_disparar) {
        // Ticket e gasto de outros dias são conferidos em "casos de outros dias", mais abaixo.
        if (n.data) continue;
        expect(gravados.has(chaveDoGabarito(n.tipo, n.produto_id, n.fornecedor_id))).toBe(false);
      }
    });

    it("a prioridade vai de 1 a 3, e os dois alertas de mais de R$ 900 do dia são prioridade 1", async () => {
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.candidatos.map((c) => c.prioridade)).toEqual(
        [...r.candidatos.map((c) => c.prioridade)].sort(),
      );
      // Dentro do mesmo nível, do maior para o menor impacto (sem impacto por último).
      const impacto = (c: (typeof r.candidatos)[number]): number => {
        const valor = c.metricasApoio.impacto_centavos;
        return typeof valor === "number" ? valor : -1;
      };
      r.candidatos.slice(1).forEach((c, i) => {
        const anterior = r.candidatos[i];
        if (anterior?.prioridade === c.prioridade)
          expect(impacto(anterior)).toBeGreaterThanOrEqual(impacto(c));
      });
      const porTipo = (tipo: string) => r.candidatos.filter((c) => c.tipo === tipo);
      expect(porTipo("ticket_medio_em_queda")[0]?.prioridade).toBe(1);
      expect(porTipo("gasto_fora_do_padrao")[0]?.prioridade).toBe(1);
      // Sem impacto em reais, giro e estoque parado ficam no nível mais baixo.
      for (const c of [...porTipo("giro_em_alta"), ...porTipo("estoque_parado")])
        expect(c.prioridade).toBe(3);
      expect(r.candidatos.every((c) => [1, 2, 3].includes(c.prioridade))).toBe(true);
    });

    it("select_alerts sobre as linhas do motor devolve a confiança real, não nula", async () => {
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      const escolhidos = r.candidatos.slice(0, 3);
      const guardada = escolhidos.map((c) => c.metricasApoio.menor_confianca);
      expect(guardada.every((v) => typeof v === "number")).toBe(true);
      const saida = await criarSelectAlerts(db).executar(
        { comercianteId: vilaNova, nomeComercio: "Vila Nova", dataReferencia: REF },
        { alertas: escolhidos.map((c) => ({ alerta_id: c.id, justificativa: "teste" })) },
      );
      expect(saida.menor_confianca).toBe(Math.min(...(guardada as number[])));
    });

    it("é idempotente: repetir no mesmo dia não cria nem altera candidato", async () => {
      const antes = await linhasDoBanco(vilaNova);
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.gravados).toBe(0);
      expect(r.candidatos).toHaveLength(16);
      expect(await linhasDoBanco(vilaNova)).toEqual(antes);
    });
  });

  describe("isolamento entre lojistas (regra inviolável 3)", () => {
    it("o motor da Esquina só grava alerta dela, sobre produtos dela", async () => {
      const antes = await linhasDoBanco(vilaNova);
      const r = await motor.executar({ comercianteId: esquina, dataReferencia: REF });
      const dela = new Set(
        (
          await db
            .select({ id: schema.produto.id })
            .from(schema.produto)
            .where(eq(schema.produto.comercianteId, esquina))
        ).map((p) => p.id),
      );
      const linhas = await linhasDoBanco(esquina);
      expect(linhas.length).toBe(r.candidatos.length);
      for (const l of linhas) {
        expect(l.comercianteId).toBe(esquina);
        if (l.produtoId) expect(dela.has(l.produtoId)).toBe(true);
      }
      // O lojista vizinho continua com os mesmos 16.
      expect(await linhasDoBanco(vilaNova)).toEqual(antes);
    });

    it("a Esquina tem 14 dias de dados: giro, ticket e gasto vêm como dado ausente, não como zero", async () => {
      const r = await motor.executar({ comercianteId: esquina, dataReferencia: REF });
      const codigos = r.ausentes.map((a) => `${a.tipo}:${a.codigo}`);
      expect(codigos).toEqual(
        expect.arrayContaining([
          "giro_em_alta:historico_insuficiente",
          "espaco_para_subir_preco:historico_insuficiente",
          "ticket_medio_em_queda:historico_insuficiente",
          "gasto_fora_do_padrao:historico_insuficiente",
        ]),
      );
      const tipos = new Set((await linhasDoBanco(esquina)).map((l) => l.tipo));
      for (const tipo of [
        "giro_em_alta",
        "espaco_para_subir_preco",
        "ticket_medio_em_queda",
        "gasto_fora_do_padrao",
      ]) {
        expect(tipos.has(tipo as never)).toBe(false);
      }
    });

    it("a supressão olha só os alertas tratados do próprio lojista", async () => {
      await db.insert(schema.alerta).values({
        comercianteId: vilaNova,
        tipo: "estoque_parado",
        prioridade: 3,
        status: "enviado",
        dataReferencia: "2026-10-18",
        chave: "qualquer",
        metricasApoio: {},
      });
      expect(await repositorio.jaTratados(esquina, "2026-10-01", REF)).toEqual([]);
      expect(await repositorio.jaTratados(vilaNova, "2026-10-01", REF)).toEqual([
        { tipo: "estoque_parado", chave: "qualquer", dataReferencia: "2026-10-18" },
      ]);
    });
  });

  describe("priorização e deduplicação (#44)", () => {
    const id = (sku: string): string => {
      const produto = produtoPorSku.get(sku);
      if (!produto) throw new Error(`Produto ${sku} não está no seed`);
      return produto;
    };
    const fornecedor = (gabaritoId: string): string => {
      const f = gabaritoPorFornecedor.get(gabaritoId);
      if (!f) throw new Error(`Fornecedor ${gabaritoId} não está no seed`);
      return f;
    };
    const tratado = (
      tipo: (typeof schema.alerta.$inferInsert)["tipo"],
      chave: string,
      dataReferencia: string,
      status: "enviado" | "descartado" | "candidato",
    ) =>
      db.insert(schema.alerta).values({
        comercianteId: vilaNova,
        tipo,
        prioridade: 2,
        status,
        dataReferencia,
        chave,
        metricasApoio: {},
      });

    beforeAll(async () => {
      await db.delete(schema.alerta).where(eq(schema.alerta.comercianteId, vilaNova));
      // O reajuste do arroz foi enviado há 2 dias; o do óleo foi descartado há 6 (ainda na semana).
      await tratado(
        "reajuste_de_custo",
        `${id("P01")}:${fornecedor("AUR")}:2026-10-16`,
        "2026-10-17",
        "enviado",
      );
      await tratado(
        "reajuste_de_custo",
        `${id("P03")}:${fornecedor("AUR")}:2026-10-13`,
        "2026-10-13",
        "descartado",
      );
      // Há 7 dias ou mais, ou ainda só candidato: não suprimem (a janela é de menos de 7 dias).
      await tratado("giro_em_alta", id("P47"), "2026-10-12", "enviado");
      await tratado("margem_abaixo_da_meta", id("P01"), "2026-10-11", "enviado");
      await tratado("estoque_parado", id("P12"), "2026-10-17", "candidato");
    });

    it("o mesmo reajuste não é sugerido duas vezes na mesma semana", async () => {
      const r = await motor.executar({ comercianteId: vilaNova, dataReferencia: REF });
      expect(r.suprimidos.map((c) => `${c.tipo}|${skuPorProduto.get(c.produtoId ?? "")}`).sort()).toEqual([
        "reajuste_de_custo|P01",
        "reajuste_de_custo|P03",
      ]);
      expect(r.candidatos.some((c) => c.tipo === "reajuste_de_custo")).toBe(false);
      expect(r.candidatos).toHaveLength(14);
    });

    it("alerta enviado há 7 dias ou mais, ou só candidato, não suprime", async () => {
      const linhas = await db
        .select()
        .from(schema.alerta)
        .where(and(eq(schema.alerta.comercianteId, vilaNova), eq(schema.alerta.dataReferencia, REF)));
      const chaves = linhas.map(chaveDaLinha);
      expect(chaves).toContain(chaveDoGabarito("giro_em_alta", "P47"));
      expect(chaves).toContain(chaveDoGabarito("margem_abaixo_da_meta", "P01"));
      expect(chaves).toContain(chaveDoGabarito("estoque_parado", "P12"));
    });

    it("o motor não altera o status de um alerta já enviado", async () => {
      const [arroz] = await db
        .select()
        .from(schema.alerta)
        .where(
          and(
            eq(schema.alerta.comercianteId, vilaNova),
            eq(schema.alerta.tipo, "reajuste_de_custo"),
            eq(schema.alerta.dataReferencia, "2026-10-17"),
          ),
        );
      expect(arroz?.status).toBe("enviado");
    });

    it("casos de outros dias: o motor não gera ticket nem gasto que o gabarito manda não disparar", async () => {
      const casos = gabarito.alertas_que_nao_devem_disparar.filter((n) => n.data);
      expect(casos.length).toBeGreaterThan(0);
      for (const n of casos) {
        await motor.executar({ comercianteId: vilaNova, dataReferencia: n.data as string });
        const doDia = await db
          .select()
          .from(schema.alerta)
          .where(
            and(
              eq(schema.alerta.comercianteId, vilaNova),
              eq(schema.alerta.dataReferencia, n.data as string),
              eq(schema.alerta.tipo, n.tipo as "ticket_medio_em_queda" | "gasto_fora_do_padrao"),
            ),
          );
        expect(doDia).toEqual([]);
      }
    });
  });
});
