/**
 * Ciclo completo no chat web, com o motor de alertas real: a nota entra pelo upload, é extraída (visão
 * falsa) e vinculada, o job de reajuste grava o candidato, o relatório diário roda na fila real, o
 * agente chama list_alert_candidates e select_alerts, o verificador aprova, a mensagem aparece no
 * chat, o alerta escolhido vira `enviado` (#155) e repetir o relatório no mesmo dia não chama o
 * modelo nem envia de novo (regra 9). Só o modelo de linguagem e a visão são falsos.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { MODELO_LINGUAGEM } from "../../src/agente/llm/modelo-linguagem";
import { FilaRelatorioDiario } from "../../src/canal/jobs/fila-relatorio-diario";
import { RelatorioDiarioService } from "../../src/canal/jobs/relatorio-diario.service";
import { RELOGIO, type Relogio } from "../../src/canal/relogio";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { carregarFixtures } from "../../src/infra/database/seed/carregar-fixtures";
import { montarSeed } from "../../src/infra/database/seed/montar-seed";
import { inserirLinhasSeed } from "../../src/infra/database/seed/semear";
import { uuidDeterministico } from "../../src/infra/database/seed/uuid-deterministico";
import type { ClienteVisao, RespostaVisao } from "../../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";
import { ModeloRelatorioFalso } from "./modelo-falso";

interface AlertaGabarito {
  tipo: string;
  produto_id: string;
  metricas: Record<string, number>;
}
const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  parametros: { data_referencia: string };
  alertas_esperados: AlertaGabarito[];
};
const REF = gabarito.parametros.data_referencia;
const reajuste = gabarito.alertas_esperados.find(
  (a) => a.tipo === "reajuste_de_custo" && a.produto_id === "P01",
)!;
// O BullMQ guarda o jobId (comerciante + data) dos jobs concluídos: ids fixos fariam a 2ª execução
// do teste ser ignorada. Por isso a chave do seed leva um sufixo novo a cada execução.
const CHAVE_SEED = `e2e-ponta-a-ponta/${randomUUID()}`;
// O telefone é único no banco: um comerciante que sobrou de uma execução interrompida não pode travar a próxima.
const TELEFONE = `55629${randomInt(10_000_000, 100_000_000)}`;

// O modelo devolve confiança alta mesmo quando erra: quem reduz é o código.
const comoDoModelo = (nota: string): RespostaVisao => {
  const e = JSON.parse(readFileSync(`fixtures/notas/${nota}.esperado.json`, "utf8"));
  e.confianca_documento = 1;
  for (const i of e.itens) i.confianca = 1;
  return {
    texto: JSON.stringify(e),
    recusou: false,
    consumo: { entrada: 2100, saida: 900, cacheLeitura: 0, cacheEscrita: 0 },
    modelo: "claude-sonnet-5-5",
  };
};

describe("demo ponta a ponta no chat web, com o motor de alertas real (e2e)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-demo-"));
  const produtoAlvo = uuidDeterministico(`${CHAVE_SEED}/produto/${reajuste.produto_id}`);
  const modelo = new ModeloRelatorioFalso(produtoAlvo);
  const visao: ClienteVisao = { extrair: () => Promise.resolve(comoDoModelo("nota-16")) };
  // 2026-10-19 11:00 em São Paulo, fora do silêncio.
  const relogioFalso: Relogio = { agora: () => new Date(`${REF}T14:00:00Z`) };
  const dataAnterior = process.env.DEMO_DATA_REFERENCIA;

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let dono = "";
  let alertaDoJob = "";

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const como = () => ({ "X-Comerciante-Id": dono });
  const esperar = async <T>(consulta: () => Promise<T | undefined>, ms = 20_000): Promise<T> => {
    const limite = Date.now() + ms;
    for (;;) {
      const v = await consulta();
      if (v !== undefined) return v;
      if (Date.now() > limite) throw new Error("Tempo esgotado esperando a condição");
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const alertasDoDono = () => db.select().from(schema.alerta).where(eq(schema.alerta.comercianteId, dono));
  const proativasDoDia = () =>
    db
      .select()
      .from(schema.mensagem)
      .where(
        and(
          eq(schema.mensagem.comercianteId, dono),
          eq(schema.mensagem.proativa, true),
          eq(schema.mensagem.dataEnvio, REF),
        ),
      );
  const execucoesDeRelatorio = () =>
    db
      .select()
      .from(schema.execucaoAgente)
      .where(
        and(
          eq(schema.execucaoAgente.comercianteId, dono),
          eq(schema.execucaoAgente.gatilho, "relatorio_diario"),
        ),
      );

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    process.env.DEMO_DATA_REFERENCIA = REF;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    // Mercadinho do seed sem a nota-16: ela entra pelo upload, e o reajuste vem do job real.
    const fix = carregarFixtures();
    const linhas = montarSeed(
      { ...fix, notas: fix.notas.filter((n) => n.id !== "nota-16") },
      {
        chave: CHAVE_SEED,
        nome: "E2E Demo Ponta a Ponta",
        telefoneWhatsapp: TELEFONE,
        margemMetaBps: fix.perfil.margem_meta_bps,
      },
    );
    dono = linhas.comerciante.id as string;
    await db.transaction((tx) => inserirLinhasSeed(tx, linhas));
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODELO_LINGUAGEM)
      .useValue(modelo)
      .overrideProvider(CLIENTE_VISAO)
      .useValue(visao)
      .overrideProvider(RELOGIO)
      .useValue(relogioFalso)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (dono) {
      await db.transaction(async (tx) => {
        // `omnia.exclusao_autorizada` libera o DELETE do histórico append-only só nesta transação.
        await tx.execute(`SET LOCAL omnia.exclusao_autorizada = 'on'`);
        await tx.delete(schema.comerciante).where(eq(schema.comerciante.id, dono));
      });
    }
    await pool?.end();
    rmSync(dirArquivos, { recursive: true, force: true });
    if (dataAnterior === undefined) delete process.env.DEMO_DATA_REFERENCIA;
    else process.env.DEMO_DATA_REFERENCIA = dataAnterior;
  }, 60_000);

  it("nota entra pelo chat, é extraída e vinculada, e o job de reajuste grava o candidato", async () => {
    const envio = await request(servidor())
      .post("/chat/notas")
      .set(como())
      .attach("arquivo", readFileSync("fixtures/notas/nota-16.jpg"), {
        filename: "nota-16.jpg",
        contentType: "image/jpeg",
      })
      .expect(202);
    const documentoId = (envio.body as { documento_id: string }).documento_id;

    const status = await esperar(async () => {
      const s = (
        (await request(servidor()).get(`/documentos/${documentoId}`).set(como())).body as { status: string }
      ).status;
      return s === "pendente" || s === "processando" ? undefined : s;
    });
    expect(["extraido", "revisao"]).toContain(status);

    const custos = await db
      .select()
      .from(schema.historicoCusto)
      .where(
        and(eq(schema.historicoCusto.comercianteId, dono), eq(schema.historicoCusto.produtoId, produtoAlvo)),
      );
    expect(custos.map((c) => c.custoUnitarioCentavos)).toContain(reajuste.metricas.custo_atual_centavos);

    // O job de reajuste (BullMQ) roda depois da extração e usa a data de referência fixada.
    const candidato = await esperar(async () =>
      (await alertasDoDono()).find((a) => a.tipo === "reajuste_de_custo" && a.produtoId === produtoAlvo),
    );
    expect(candidato).toMatchObject({ status: "candidato", dataReferencia: REF });
    expect(candidato.metricasApoio).toMatchObject(reajuste.metricas);
    alertaDoJob = candidato.id;
  }, 60_000);

  it("o dono conversa e a resposta sai pelo chat", async () => {
    await request(servidor())
      .post("/chat/mensagens")
      .set(como())
      .send({ id_externo: randomUUID(), texto: "Como está o meu negócio?" })
      .expect(200);

    const lista = (await request(servidor()).get("/chat/mensagens").set(como()).expect(200)).body as Array<{
      direcao: string;
    }>;
    // Entre a foto e a conversa vêm a leitura da nota e as primeiras perguntas dela (#182), todas enviadas.
    const direcoes = lista.map((m) => m.direcao);
    expect(direcoes.slice(0, 2)).toEqual(["recebida", "enviada"]);
    expect(direcoes.slice(-2)).toEqual(["recebida", "enviada"]);
    expect(direcoes.filter((d) => d === "recebida")).toHaveLength(2);
    expect(modelo.chamadasRelatorio).toBe(0);
  });

  it("o relatório diário roda o motor real, o agente escolhe o reajuste e a mensagem sai verificada no chat web", async () => {
    await app.get(FilaRelatorioDiario).enfileirar({ comercianteId: dono, data: REF });
    // A mensagem é gravada antes da entrega e o alerta só vira enviado depois: espera o fim do job.
    await esperar(async () =>
      (await alertasDoDono()).some((a) => a.id === alertaDoJob && a.status === "enviado") ? true : undefined,
    );

    const lista = (await request(servidor()).get("/chat/mensagens").set(como()).expect(200)).body as Array<{
      direcao: string;
      proativa: boolean;
      texto: string;
    }>;
    const ultima = lista[lista.length - 1]!;
    expect(ultima).toMatchObject({ direcao: "enviada", proativa: true });
    expect(ultima.texto).toContain("12,05%");
    expect(ultima.texto).toContain("R$ 24,90");
    expect(ultima.texto).toContain("R$ 27,90");

    const [execucao] = await execucoesDeRelatorio();
    expect(execucao?.resultado).toBe("aprovada");
    const chamadas = await db
      .select()
      .from(schema.chamadaFerramenta)
      .where(eq(schema.chamadaFerramenta.execucaoId, execucao!.id))
      .orderBy(asc(schema.chamadaFerramenta.ordem));
    expect(chamadas.map((c) => c.ferramenta)).toEqual(["list_alert_candidates", "select_alerts"]);
    expect((chamadas[0]!.saida as { n_registros: number }).n_registros).toBe(
      gabarito.alertas_esperados.length,
    );
    expect(
      (chamadas[1]!.entrada as { alertas: Array<{ alerta_id: string }> }).alertas.map((a) => a.alerta_id),
    ).toEqual([alertaDoJob]);
  }, 60_000);

  it("o alerta escolhido vira enviado e os outros seguem candidatos (#155)", async () => {
    const [execucao] = await execucoesDeRelatorio();
    const alertas = await alertasDoDono();
    const escolhido = alertas.find((a) => a.id === alertaDoJob)!;
    expect(escolhido.status).toBe("enviado");
    expect(escolhido.enviadoEm).not.toBeNull();
    expect(escolhido.execucaoId).toBe(execucao!.id);
    const outros = alertas.filter((a) => a.id !== alertaDoJob);
    expect(outros).toHaveLength(gabarito.alertas_esperados.length - 1);
    expect(outros.every((a) => a.status === "candidato")).toBe(true);
  });

  it("regra 9: repetir o relatório no mesmo dia não chama o modelo nem envia de novo", async () => {
    const antes = modelo.chamadas;
    const job = { comercianteId: dono, data: REF };
    expect(await app.get(RelatorioDiarioService).processar(job)).toBe("ja_enviada_hoje");
    await app.get(FilaRelatorioDiario).enfileirar(job);
    await new Promise((r) => setTimeout(r, 1_000));

    expect(await proativasDoDia()).toHaveLength(1);
    expect(modelo.chamadas).toBe(antes);
    expect(await execucoesDeRelatorio()).toHaveLength(1);
    expect((await alertasDoDono()).find((a) => a.id === alertaDoJob)?.status).toBe("enviado");
  });

  it("todas as execuções do ciclo foram aprovadas", async () => {
    const execucoes = await db
      .select()
      .from(schema.execucaoAgente)
      .where(eq(schema.execucaoAgente.comercianteId, dono));
    expect(execucoes.map((e) => e.gatilho).sort()).toEqual([
      "extracao_nota",
      "mensagem_dono",
      "relatorio_diario",
    ]);
    expect(execucoes.every((e) => e.resultado === "aprovada")).toBe(true);
  });
});
