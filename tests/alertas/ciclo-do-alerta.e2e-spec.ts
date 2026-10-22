import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { RegistroExecucoesPostgres } from "../../src/agente/execucao/registro-execucoes";
import { CicloDoAlerta } from "../../src/alertas/ciclo-do-alerta";
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
 * Issue #155: os status finais `enviado` e `descartado` são gravados no alerta, e a supressão de
 * 7 dias passa a valer de ponta a ponta (relatório de um dia, motor do dia seguinte).
 */
describe("ciclo do alerta (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  const motor = new MotorDeAlertas(
    new MetricasService(new RepositorioMetricasPostgres(db)),
    new RepositorioAlertasPostgres(db),
    fonteDeLimitesPadrao,
  );
  const ciclo = new CicloDoAlerta(db);
  const registro = new RegistroExecucoesPostgres(db);
  const DIA = "2026-10-19";
  const VESPERA = "2026-10-18";

  let vilaNova: string;
  let esquina: string;

  /** Uma execução do relatório diário cuja chamada select_alerts escolheu estes alertas. */
  const execucaoComEscolha = (
    comercianteId: string,
    alertaIds: string[],
    erro: string | null = null,
    resultado: "aprovada" | "fallback_verificador" = "aprovada",
  ) =>
    registro.salvar({
      comercianteId,
      gatilho: "relatorio_diario",
      entrada: "Relatório diário",
      modelo: "falso",
      versaoPrompt: "v3",
      resultado,
      mensagemFinal: "Bom dia",
      iteracoes: 1,
      bloqueios: [],
      tokensEntrada: 1,
      tokensSaida: 1,
      tokensCacheLeitura: 0,
      custoEstimadoMicrodolares: 0,
      latenciaMs: 1,
      erro: null,
      chamadas: [
        {
          ordem: 1,
          ferramenta: "select_alerts",
          entrada: {
            alertas: alertaIds.map((alerta_id) => ({
              alerta_id,
              justificativa: `escolhido ${alerta_id.slice(0, 4)}`,
            })),
          },
          saida: erro ? null : { selecionados: alertaIds.length },
          erro,
          menorConfianca: null,
          latenciaMs: 1,
        },
      ],
    });

  const linha = async (id: string) => {
    const [l] = await db.select().from(schema.alerta).where(eq(schema.alerta.id, id));
    if (!l) throw new Error(`Alerta ${id} sumiu`);
    return l;
  };

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
  });
  afterAll(() => pool.end());

  describe("marcarEnviados", () => {
    let candidatos: Awaited<ReturnType<MotorDeAlertas["executar"]>>["candidatos"];
    let execucaoDoEnvio: string;

    beforeAll(async () => {
      candidatos = (await motor.executar({ comercianteId: vilaNova, dataReferencia: DIA })).candidatos;
      expect(candidatos.length).toBeGreaterThan(3);
    });

    it("só os alertas escolhidos viram enviado, com data, execução e justificativa; o resto segue candidato", async () => {
      const escolhidos = candidatos.slice(0, 3).map((c) => c.id);
      const execucaoId = await execucaoComEscolha(vilaNova, escolhidos);
      execucaoDoEnvio = execucaoId;
      const marcados = await ciclo.marcarEnviados(vilaNova, execucaoId, new Date("2026-10-19T14:00:00Z"));
      expect(marcados).toBe(3);
      for (const id of escolhidos) {
        expect(await linha(id)).toMatchObject({
          status: "enviado",
          execucaoId,
          enviadoEm: new Date("2026-10-19T14:00:00Z"),
          justificativa: expect.stringContaining("escolhido") as string,
        });
      }
      for (const c of candidatos.slice(3)) expect((await linha(c.id)).status).toBe("candidato");
    });

    it("repetir não muda nada (idempotente)", async () => {
      const antes = await linha(candidatos[0]!.id);
      expect(await ciclo.marcarEnviados(vilaNova, execucaoDoEnvio, new Date())).toBe(0);
      expect(await linha(candidatos[0]!.id)).toEqual(antes);
    });

    it("o motor rodando de novo no mesmo dia não devolve um enviado a candidato", async () => {
      await motor.executar({ comercianteId: vilaNova, dataReferencia: DIA });
      expect((await linha(candidatos[0]!.id)).status).toBe("enviado");
      const doDia = (await motor.executar({ comercianteId: vilaNova, dataReferencia: DIA })).candidatos;
      expect(doDia.map((c) => c.id)).not.toContain(candidatos[0]!.id);
    });

    it("chamada de select_alerts que falhou não marca nada", async () => {
      const alvo = candidatos[5]!.id;
      const execucaoId = await execucaoComEscolha(vilaNova, [alvo], "alerta inexistente");
      expect(await ciclo.marcarEnviados(vilaNova, execucaoId)).toBe(0);
      expect((await linha(alvo)).status).toBe("candidato");
    });

    it("mensagem que foi um fallback (o dono não viu os alertas) não marca nada", async () => {
      const alvo = candidatos[7]!.id;
      const execucaoId = await execucaoComEscolha(vilaNova, [alvo], null, "fallback_verificador");
      expect(await ciclo.marcarEnviados(vilaNova, execucaoId)).toBe(0);
      expect((await linha(alvo)).status).toBe("candidato");
    });

    it("reconciliar: se o processo caiu entre o envio e a marcação, a mensagem do dia recupera os alertas", async () => {
      const alvo = candidatos[8]!.id;
      const execucaoId = await execucaoComEscolha(vilaNova, [alvo]);
      await db.insert(schema.mensagem).values({
        comercianteId: vilaNova,
        direcao: "enviada",
        canal: "web",
        texto: "Bom dia",
        proativa: true,
        dataEnvio: DIA,
        execucaoId,
        chaveIdempotencia: "relatorio_teste_reconciliar",
      });
      expect(await ciclo.reconciliar(vilaNova, DIA)).toBe(1);
      expect((await linha(alvo)).status).toBe("enviado");
      expect(await ciclo.reconciliar(vilaNova, DIA)).toBe(0);
      // Outro lojista não enxerga a mensagem do dia.
      expect(await ciclo.reconciliar(esquina, DIA)).toBe(0);
    });

    it("outro lojista não consegue marcar o alerta de um lojista: o comerciante da execução é o que vale", async () => {
      const alvo = candidatos[6]!.id;
      const execucaoDaEsquina = await execucaoComEscolha(esquina, [alvo]);
      expect(await ciclo.marcarEnviados(esquina, execucaoDaEsquina)).toBe(0);
      expect((await linha(alvo)).status).toBe("candidato");
      // E a execução de um lojista consultada pelo id do outro não encontra chamada nenhuma.
      const execucaoDaVila = await execucaoComEscolha(vilaNova, [alvo]);
      expect(await ciclo.marcarEnviados(esquina, execucaoDaVila)).toBe(0);
      expect((await linha(alvo)).status).toBe("candidato");
    });

    it("não apaga nada: continuam as mesmas linhas do dia", async () => {
      const linhas = await db
        .select({ id: schema.alerta.id })
        .from(schema.alerta)
        .where(and(eq(schema.alerta.comercianteId, vilaNova), eq(schema.alerta.dataReferencia, DIA)));
      expect(linhas.length).toBe(candidatos.length);
    });
  });

  describe("descartar", () => {
    it("candidato dispensado vira descartado com a justificativa; enviado não volta atrás", async () => {
      const candidatos = (await motor.executar({ comercianteId: esquina, dataReferencia: DIA })).candidatos;
      expect(candidatos.length).toBeGreaterThan(0);
      const alvo = candidatos[0]!.id;
      expect(await ciclo.descartar(esquina, alvo, "o dono não quer")).toBe(true);
      expect(await linha(alvo)).toMatchObject({ status: "descartado", justificativa: "o dono não quer" });
      expect(await ciclo.descartar(esquina, alvo, "de novo")).toBe(false);
    });

    it("não descarta alerta de outro lojista", async () => {
      const [alvo] = await db
        .select()
        .from(schema.alerta)
        .where(and(eq(schema.alerta.comercianteId, vilaNova), eq(schema.alerta.status, "candidato")))
        .limit(1);
      expect(await ciclo.descartar(esquina, alvo!.id, "invasão")).toBe(false);
      expect((await linha(alvo!.id)).status).toBe("candidato");
    });
  });

  describe("supressão de ponta a ponta", () => {
    it("o alerta enviado na véspera não é gerado de novo no dia seguinte, dentro da janela", async () => {
      await db.delete(schema.alerta).where(eq(schema.alerta.comercianteId, vilaNova));
      const vespera = (await motor.executar({ comercianteId: vilaNova, dataReferencia: VESPERA })).candidatos;
      const margem = vespera.filter((c) => c.tipo === "margem_abaixo_da_meta");
      expect(margem.length).toBeGreaterThan(0);
      const execucaoId = await execucaoComEscolha(
        vilaNova,
        margem.map((c) => c.id),
      );
      expect(await ciclo.marcarEnviados(vilaNova, execucaoId)).toBe(margem.length);

      const hoje = await motor.executar({ comercianteId: vilaNova, dataReferencia: DIA });
      const chavesEnviadas = new Set(margem.map((c) => c.chave));
      expect(
        hoje.candidatos.filter((c) => c.tipo === "margem_abaixo_da_meta" && chavesEnviadas.has(c.chave)),
      ).toEqual([]);
      expect(hoje.suprimidos.filter((c) => c.tipo === "margem_abaixo_da_meta")).toHaveLength(margem.length);
    });

    it("sem o envio registrado, o mesmo alerta volta no dia seguinte (o motivo do #155)", async () => {
      await db.delete(schema.alerta).where(eq(schema.alerta.comercianteId, esquina));
      const vespera = (await motor.executar({ comercianteId: esquina, dataReferencia: VESPERA })).candidatos;
      const dia = (await motor.executar({ comercianteId: esquina, dataReferencia: DIA })).candidatos;
      const chavesDaVespera = new Set(vespera.map((c) => `${c.tipo}|${c.chave}`));
      expect(dia.some((c) => chavesDaVespera.has(`${c.tipo}|${c.chave}`))).toBe(true);
    });
  });
});
