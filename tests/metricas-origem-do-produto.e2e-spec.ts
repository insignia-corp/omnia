import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { somarDias } from "../src/lib/datas/datas";
import { DIAS_DE_HISTORICO_DO_GIRO } from "../src/metricas/giro";
import { MetricasService } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente } from "../src/metricas/resultado-metrica";

/**
 * Origem e confiança do cadastro do produto (#144, regra inviolável 4): o produto de catálogo sem
 * nenhuma venda aparece no giro e o resultado diz de onde ele veio e quanto se confia nele.
 */

const REF = "2026-10-19";

describe("métricas e a origem do produto (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const servico = new MetricasService(new RepositorioMetricasPostgres(db));
  let comercianteId: string;
  let produtoDeNotaId: string;

  beforeAll(async () => {
    await migrar(url);
    const [c] = await db
      .insert(schema.comerciante)
      .values({ nome: "Teste origem do produto" })
      .returning({ id: schema.comerciante.id });
    if (!c) throw new Error("comerciante não criado");
    comercianteId = c.id;
    const produtos = await db
      .insert(schema.produto)
      .values([
        { comercianteId, nome: "Arroz", origem: "foto_nota", confianca: 0.6 },
        { comercianteId, nome: "Feijão", origem: "dono", confianca: 1 },
      ])
      .returning({ id: schema.produto.id, nome: schema.produto.nome });
    produtoDeNotaId = produtos.find((p) => p.nome === "Arroz")?.id ?? "";
    // Vendas (sem itens) só para o período do giro estar coberto: nenhum produto vendeu.
    await db.insert(schema.venda).values(
      [somarDias(REF, -(DIAS_DE_HISTORICO_DO_GIRO - 1)), REF].map((data) => ({
        comercianteId,
        data,
        numeroCupom: `cupom-${data}`,
        totalCentavos: 1000,
        origem: "planilha" as const,
      })),
    );
  });

  afterAll(async () => {
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, comercianteId));
    await pool.end();
  });

  it("produto de catálogo sem venda entra no giro com a origem e a confiança do cadastro", async () => {
    const r = await servico.giro({ comercianteId, dataReferencia: REF });
    if (ehDadoAusente(r)) throw new Error(`Esperava giro, veio ausente: ${r.codigo}`);
    expect(r.valor.por_produto.find((g) => g.produto_id === produtoDeNotaId)?.unidades_7_dias).toBe(0);
    expect(r.menor_confianca).toBe(0.6);
    expect(r.origens).toEqual(["dono", "foto_nota"]);
    expect(r.n_registros).toBe(0);
  });
});
