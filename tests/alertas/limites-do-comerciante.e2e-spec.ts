import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { MotorDeAlertas } from "../../src/alertas/motor-de-alertas";
import {
  FonteDeLimitesPostgres,
  limiteVigente,
  registrarLimite,
} from "../../src/alertas/limites-do-comerciante";
import { RepositorioAlertasPostgres } from "../../src/alertas/repositorio-alertas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { MetricasService } from "../../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../../src/metricas/repositorio-metricas";

/**
 * Critério de pronto da issue #147: mudar o limite de um comerciante altera os candidatos dele e não
 * os de outro; o limite anterior fica no histórico.
 */

const REF = (
  JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
    parametros: { data_referencia: string };
  }
).parametros.data_referencia;

describe("limites de alerta por comerciante (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const fonte = new FonteDeLimitesPostgres(db);
  const motor = new MotorDeAlertas(
    new MetricasService(new RepositorioMetricasPostgres(db)),
    new RepositorioAlertasPostgres(db),
    fonte,
  );

  let vilaNova: string;
  let esquina: string;

  const tiposDe = async (comercianteId: string): Promise<string[]> =>
    (await motor.executar({ comercianteId, dataReferencia: REF })).candidatos.map((c) => c.tipo).sort();

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
  });
  afterAll(() => pool.end());

  it("sem limite gravado, a fonte não sobrepõe nada", async () => {
    expect(await fonte.limitesDoComerciante(vilaNova)).toEqual({ janelaSupressaoDias: {} });
  });

  it("o limite de um comerciante muda os candidatos dele e não os do outro", async () => {
    const vilaAntes = await tiposDe(vilaNova);
    const esquinaAntes = await tiposDe(esquina);
    expect(vilaAntes).toContain("reajuste_de_custo");

    // Um reajuste só dispara acima de 99 000 pontos-base (990%): nenhum do seed chega lá.
    await registrarLimite(db, vilaNova, "reajusteLimiteBps", 99_000);

    expect(await fonte.limitesDoComerciante(vilaNova)).toMatchObject({ reajusteLimiteBps: 99_000 });
    expect(await fonte.limitesDoComerciante(esquina)).toEqual({ janelaSupressaoDias: {} });
    expect(await tiposDe(vilaNova)).not.toContain("reajuste_de_custo");
    expect(await tiposDe(esquina)).toEqual(esquinaAntes);
  });

  it("vale o limite mais recente e o anterior fica como histórico", async () => {
    await registrarLimite(db, vilaNova, "reajusteLimiteBps", 1_000);
    expect(await limiteVigente(db, vilaNova, "reajusteLimiteBps")).toEqual({ valor: 1_000 });
    expect(await fonte.limitesDoComerciante(vilaNova)).toMatchObject({ reajusteLimiteBps: 1_000 });

    const historico = await db
      .select({ valor: schema.limiteAlerta.valor })
      .from(schema.limiteAlerta)
      .where(
        and(
          eq(schema.limiteAlerta.comercianteId, vilaNova),
          eq(schema.limiteAlerta.limite, "reajusteLimiteBps"),
        ),
      );
    expect(historico.map((l) => Number(l.valor)).sort((a, b) => a - b)).toEqual([1_000, 99_000]);
  });

  it("guarda a janela de supressão sem limite de idade como nulo", async () => {
    await registrarLimite(db, esquina, "janelaSupressaoDias.estoque_parado", null);
    const sobreposicao = await fonte.limitesDoComerciante(esquina);
    expect(sobreposicao.janelaSupressaoDias).toEqual({ estoque_parado: null });
    expect((await fonte.limitesDoComerciante(vilaNova)).janelaSupressaoDias).toEqual({});
  });

  it("não grava limite com nome ou valor inválido", async () => {
    await expect(registrarLimite(db, vilaNova, "limiteInventado", 1)).rejects.toThrow(/desconhecido/);
    await expect(registrarLimite(db, vilaNova, "reajusteLimiteBps", -5)).rejects.toThrow(/inválido/);
  });

  it("a tabela é append-only: alterar ou apagar uma linha falha", async () => {
    await expect(
      db
        .update(schema.limiteAlerta)
        .set({ valor: "1" })
        .where(eq(schema.limiteAlerta.comercianteId, vilaNova)),
    ).rejects.toThrow();
    await expect(
      db.delete(schema.limiteAlerta).where(eq(schema.limiteAlerta.comercianteId, vilaNova)),
    ).rejects.toThrow();
  });

  it("o banco recusa nulo fora das janelas de supressão", async () => {
    await expect(
      db
        .insert(schema.limiteAlerta)
        .values({ comercianteId: vilaNova, limite: "reajusteLimiteBps", valor: null }),
    ).rejects.toThrow();
  });
});
