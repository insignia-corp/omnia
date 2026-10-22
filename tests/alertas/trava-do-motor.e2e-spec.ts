import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { RepositorioAlertasPostgres } from "../../src/alertas/repositorio-alertas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";

/**
 * A trava do motor (#157) é do banco, não do processo (regra inviolável 11): duas instâncias do
 * repositório, como dois processos, respeitam a mesma trava por comerciante e dia e o mesmo teto de
 * execuções simultâneas.
 */
describe("trava do motor de alertas (e2e)", () => {
  const pool = new Pool({ connectionString: carregarEnv().DATABASE_URL, max: 10 });
  const db = drizzle(pool, { schema });
  const repositorios = [new RepositorioAlertasPostgres(db), new RepositorioAlertasPostgres(db)];
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    await migrar(carregarEnv().DATABASE_URL);
  });

  it("mesmo comerciante e dia, mesmo em repositórios diferentes: uma execução de cada vez", async () => {
    let ativas = 0;
    let pico = 0;
    await Promise.all(
      [0, 1, 2, 3, 4, 5].map((i) =>
        repositorios[i % 2]!.comExclusao("c-trava-igual", "2026-10-19", async () => {
          ativas++;
          pico = Math.max(pico, ativas);
          await espera(15);
          ativas--;
        }),
      ),
    );
    expect(pico).toBe(1);
  });

  it("comerciantes diferentes rodam juntos, até o teto de vagas, sem esgotar o pool", async () => {
    let ativas = 0;
    let pico = 0;
    const executadas: number[] = [];
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repositorios[i % 2]!.comExclusao(`c-trava-${i}`, "2026-10-19", async () => {
          ativas++;
          pico = Math.max(pico, ativas);
          // O corpo precisa de outra conexão, como o motor: sem teto o pool de 10 travaria.
          await db.execute(sql`select 1`);
          await espera(30);
          ativas--;
          executadas.push(i);
        }),
      ),
    );
    expect(executadas).toHaveLength(12);
    expect(pico).toBeGreaterThan(1);
    expect(pico).toBeLessThanOrEqual(4);
  });

  it("uma execução que falha libera a vaga e a trava", async () => {
    await expect(
      repositorios[0]!.comExclusao("c-trava-falha", "2026-10-19", () => Promise.reject(new Error("falhou"))),
    ).rejects.toThrow("falhou");
    await expect(
      repositorios[1]!.comExclusao("c-trava-falha", "2026-10-19", () => Promise.resolve("ok")),
    ).resolves.toBe("ok");
  });

  afterAll(() => pool.end());
});
