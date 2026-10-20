import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AppModule } from "../../src/app.module";
import { MODELO_LINGUAGEM } from "../../src/agente/llm/modelo-linguagem";
import { CaixaMensagens } from "../../src/canal/caixa-mensagens";
import { FilaRelatorioDiario } from "../../src/canal/jobs/fila-relatorio-diario";
import { RelatorioDiarioService } from "../../src/canal/jobs/relatorio-diario.service";
import { CanalMemoria, MESSAGE_CHANNEL } from "../../src/canal/message-channel";
import { RELOGIO, type Relogio } from "../../src/canal/relogio";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { ModeloFalso } from "../demo/modelo-falso";

/** Regra inviolável 9: chave comerciante + data e no máximo uma mensagem proativa por dia. */
describe("relatório diário (e2e, regra 9)", () => {
  const canal = new CanalMemoria();
  const modelo = new ModeloFalso("Bom dia. Seu negócio segue sem novidades urgentes.");
  // 2026-10-20 11:00 em São Paulo, fora do silêncio.
  const relogio = { atual: new Date("2026-10-20T14:00:00Z") };
  const relogioFalso: Relogio = { agora: () => relogio.atual };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let servico: RelatorioDiarioService;
  let caixa: CaixaMensagens;
  let fila: FilaRelatorioDiario;
  const ids: string[] = [];

  const novoComerciante = async (nome: string) => {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning({ id: schema.comerciante.id });
    ids.push(c!.id);
    return c!.id;
  };
  const proativas = (comercianteId: string, data?: string) =>
    db
      .select()
      .from(schema.mensagem)
      .where(
        and(
          eq(schema.mensagem.comercianteId, comercianteId),
          eq(schema.mensagem.proativa, true),
          ...(data ? [eq(schema.mensagem.dataEnvio, data)] : []),
        ),
      );
  const enviosDe = (comercianteId: string) => canal.enviadas.filter((e) => e.destinatario === comercianteId);

  beforeAll(async () => {
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODELO_LINGUAGEM)
      .useValue(modelo)
      .overrideProvider(MESSAGE_CHANNEL)
      .useValue(canal)
      .overrideProvider(RELOGIO)
      .useValue(relogioFalso)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
    servico = app.get(RelatorioDiarioService);
    caixa = app.get(CaixaMensagens);
    fila = app.get(FilaRelatorioDiario);
  });

  afterAll(async () => {
    await app?.close();
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, ids));
    await pool.end();
  });

  beforeEach(() => {
    relogio.atual = new Date("2026-10-20T14:00:00Z");
  });

  it("disparar duas vezes em sequência envia uma só mensagem", async () => {
    const c = await novoComerciante("E2E Relatório sequência");
    const job = { comercianteId: c, data: "2026-10-20" };
    expect(await servico.processar(job)).toBe("enviada");
    expect(await servico.processar(job)).toBe("ja_enviada_hoje");
    expect(enviosDe(c)).toHaveLength(1);
    expect(await proativas(c)).toHaveLength(1);
  });

  it("disparar duas vezes ao mesmo tempo envia uma só mensagem", async () => {
    const c = await novoComerciante("E2E Relatório paralelo");
    const job = { comercianteId: c, data: "2026-10-20" };
    const resultados = await Promise.all([servico.processar(job), servico.processar(job)]);
    expect(resultados.filter((r) => r === "enviada")).toHaveLength(1);
    expect(enviosDe(c)).toHaveLength(1);
    expect(await proativas(c)).toHaveLength(1);
  });

  it("enfileirar a mesma chave duas vezes envia uma só mensagem", async () => {
    const c = await novoComerciante("E2E Relatório fila");
    const job = { comercianteId: c, data: "2026-10-20" };
    await fila.enfileirar(job);
    await fila.enfileirar(job);
    const limite = Date.now() + 15_000;
    while ((await proativas(c)).length === 0 && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 500));
    expect(enviosDe(c)).toHaveLength(1);
    expect(await proativas(c)).toHaveLength(1);
  });

  it("outro dia envia de novo", async () => {
    const c = await novoComerciante("E2E Relatório outro dia");
    expect(await servico.processar({ comercianteId: c, data: "2026-10-20" })).toBe("enviada");
    expect(await servico.processar({ comercianteId: c, data: "2026-10-21" })).toBe("enviada");
    expect(enviosDe(c)).toHaveLength(2);
  });

  it("não envia em horário de silêncio", async () => {
    const c = await novoComerciante("E2E Relatório silêncio");
    // 23h30 em São Paulo.
    relogio.atual = new Date("2026-10-21T02:30:00Z");
    expect(await servico.processar({ comercianteId: c, data: "2026-10-20" })).toBe("silencio");
    expect(enviosDe(c)).toHaveLength(0);
  });

  it("outra proativa do dia, com outra chave, bloqueia o relatório", async () => {
    const c = await novoComerciante("E2E Relatório alerta antes");
    const alerta = await caixa.enviarProativa({
      comercianteId: c,
      texto: "Alerta de reajuste de fornecedor.",
      execucaoId: null,
      dataEnvio: "2026-10-20",
      chave: "alerta_reajuste_2026-10-20",
    });
    expect(alerta).toBe("enviada");
    expect(await servico.processar({ comercianteId: c, data: "2026-10-20" })).toBe("ja_enviada_hoje");
    // Mesmo sem o pré-teste, o banco barra: duas proativas no dia nunca existem.
    const direto = await caixa.enviarProativa({
      comercianteId: c,
      texto: "Segunda proativa.",
      execucaoId: null,
      dataEnvio: "2026-10-20",
      chave: "relatorio_extra",
    });
    expect(direto).toBe("duplicada");
    expect(enviosDe(c)).toHaveLength(1);
    expect(await proativas(c, "2026-10-20")).toHaveLength(1);
  });
});
