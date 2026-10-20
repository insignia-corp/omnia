import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import request from "supertest";
import {
  RegistroExecucoesPostgres,
  type ExecucaoRegistrada,
} from "../../src/agente/execucao/registro-execucoes";
import { AppModule } from "../../src/app.module";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";

const base = (comercianteId: string, extra: Partial<ExecucaoRegistrada> = {}): ExecucaoRegistrada => ({
  comercianteId,
  gatilho: "mensagem_dono",
  entrada: "Qual a margem do arroz?",
  modelo: "claude-sonnet-5-5",
  versaoPrompt: "sistema-v1",
  resultado: "aprovada",
  mensagemFinal: "A margem do arroz é de 18,2%.",
  iteracoes: 2,
  bloqueios: [],
  tokensEntrada: 2000,
  tokensSaida: 150,
  tokensCacheLeitura: 0,
  custoEstimadoMicrodolares: 5500,
  latenciaMs: 1800,
  erro: null,
  chamadas: [],
  ...extra,
});

const chamada = (ordem: number, ferramenta: string) => ({
  ordem,
  ferramenta,
  entrada: { produto: "Arroz" },
  saida: { n_registros: ordem },
  erro: null,
  menorConfianca: 0.9,
  latenciaMs: 10 * ordem,
});

describe("consulta do registro de execuções (e2e)", () => {
  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let a = "";
  let b = "";
  let execucaoComChamadas = "";
  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const get = (dono: string, caminho: string) =>
    request(servidor()).get(caminho).set("X-Comerciante-Id", dono);

  beforeAll(async () => {
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const donos = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Execuções A" }, { nome: "E2E Execuções B" }])
      .returning();
    a = donos[0]!.id;
    b = donos[1]!.id;

    const registro = new RegistroExecucoesPostgres(db);
    // Fora de ordem de propósito: a consulta devolve por `ordem`.
    execucaoComChamadas = await registro.salvar(
      base(a, {
        iteracoes: 3,
        chamadas: [chamada(2, "get_cost_changes"), chamada(1, "get_product_margin")],
      }),
    );
    await registro.salvar(
      base(a, {
        resultado: "fallback_verificador",
        bloqueios: [
          { tentativa: 1, numeros: ["20%"] },
          { tentativa: 2, numeros: ["21%"] },
        ],
      }),
    );
    await registro.salvar(base(a, { bloqueios: [{ tentativa: 1, numeros: ["R$ 9,99"] }] }));
    // A extração não passa pelo verificador: fica fora da métrica de bloqueio.
    await registro.salvar(base(a, { gatilho: "extracao_nota", bloqueios: [] }));
    await registro.salvar(base(b));

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await db.delete(schema.comerciante).where(sql`${schema.comerciante.id} in (${a}, ${b})`);
    await app.close();
    await pool.end();
  });

  it("devolve a execução com as chamadas de ferramenta em ordem", async () => {
    const res = await get(a, `/execucoes/${execucaoComChamadas}`).expect(200);
    const corpo = res.body as ExecucaoRegistrada & { id: string };
    expect(corpo.id).toBe(execucaoComChamadas);
    expect(corpo.chamadas.map((c) => c.ferramenta)).toEqual(["get_product_margin", "get_cost_changes"]);
    expect(corpo).toMatchObject({ gatilho: "mensagem_dono", modelo: "claude-sonnet-5-5", iteracoes: 3 });
  });

  it("execução de outro comerciante não existe para quem pergunta (isolamento)", async () => {
    await get(b, `/execucoes/${execucaoComChamadas}`).expect(404);
  });

  it("sem identificação da sessão, 401", async () => {
    await request(servidor()).get(`/execucoes/${execucaoComChamadas}`).expect(401);
    await request(servidor()).get("/execucoes").expect(401);
  });

  it("lista só as execuções do comerciante da sessão, mais recentes primeiro", async () => {
    const res = await get(a, "/execucoes?limite=3").expect(200);
    const lista = res.body as { id: string; criadoEm: string }[];
    expect(lista).toHaveLength(3);
    const datas = lista.map((e) => e.criadoEm);
    expect([...datas].sort().reverse()).toEqual(datas);
    const todas = (await get(b, "/execucoes").expect(200)).body as unknown[];
    expect(todas).toHaveLength(1);
  });

  it("taxa de bloqueio por dia conta só o Analista e usa pontos-base", async () => {
    const hoje = (
      await db.execute<{ d: string }>(
        sql`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') as d`,
      )
    ).rows[0]!.d;
    const res = await get(a, `/execucoes/verificador/bloqueios?de=${hoje}&ate=${hoje}`).expect(200);
    expect(res.body).toEqual([
      { data: hoje, execucoes: 3, comBloqueio: 2, fallbacksVerificador: 1, taxaBloqueioBps: 6667 },
    ]);
  });

  it("período inválido ou ausente, 400", async () => {
    await get(a, "/execucoes/verificador/bloqueios").expect(400);
    await get(a, "/execucoes/verificador/bloqueios?de=2026-10-20&ate=2026-10-01").expect(400);
    await get(a, "/execucoes/verificador/bloqueios?de=ontem&ate=hoje").expect(400);
  });

  it("id que não é UUID, 400", async () => {
    await get(a, "/execucoes/nao-e-uuid").expect(400);
  });
});
