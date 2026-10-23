import type {
  BetaContentBlock,
  BetaMessage,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { z } from "zod";
import { AgenteService, FALLBACK } from "../../src/agente/agente.service";
import { carregarHistorico } from "../../src/agente/conversa/historico";
import { RegistroExecucoesPostgres } from "../../src/agente/execucao/registro-execucoes";
import { definirFerramenta } from "../../src/agente/ferramentas/ferramenta";
import { RegistroFerramentas } from "../../src/agente/ferramentas/registro-ferramentas";
import { criarSelectAlerts } from "../../src/agente/ferramentas/select-alerts";
import type { ModeloLinguagem, PedidoModelo } from "../../src/agente/llm/modelo-linguagem";
import { carregarPromptSistema } from "../../src/agente/prompts/prompt-sistema";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";

const DATA = "2026-10-19";

function resposta(stop_reason: BetaStopReason, content: unknown[]): BetaMessage {
  return {
    id: "msg_e2e",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason,
    content: content as BetaContentBlock[],
    usage: {
      input_tokens: 1500,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  } as unknown as BetaMessage;
}
const texto = (t: string) => resposta("end_turn", [{ type: "text", text: t }]);
const chamar = (name: string, input: unknown, id: string) =>
  resposta("tool_use", [{ type: "tool_use", id, name, input }]);

class ModeloRoteirizado implements ModeloLinguagem {
  readonly nome = "claude-sonnet-5-5";
  readonly pedidos: PedidoModelo[] = [];
  constructor(private readonly respostas: BetaMessage[]) {}
  gerar(pedido: PedidoModelo): Promise<BetaMessage> {
    this.pedidos.push({ ...pedido, messages: structuredClone(pedido.messages) });
    const r = this.respostas.shift();
    return r ? Promise.resolve(r) : Promise.reject(new Error("Roteiro do modelo acabou"));
  }
}

describe("loop do agente com banco real (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  const registro = new RegistroExecucoesPostgres(db);
  let a = "";
  let b = "";
  const alertaIds: string[] = [];
  let alertaDeB = "";
  let alertaDeOutroDia = "";

  const contexto = (comercianteId: string) => ({
    comercianteId,
    nomeComercio: "Mercadinho E2E",
    dataReferencia: DATA,
  });

  /** Dublê do list_alert_candidates (plano A): lê a tabela alerta do comerciante da sessão. */
  const listarCandidatos = definirFerramenta({
    nome: "list_alert_candidates",
    descricao: "Candidatos a alerta do dia.",
    entrada: z.strictObject({}),
    efeito: "nenhum",
    async executar(ctx) {
      const linhas = await db
        .select()
        .from(schema.alerta)
        .where(
          and(eq(schema.alerta.comercianteId, ctx.comercianteId), eq(schema.alerta.dataReferencia, DATA)),
        )
        .orderBy(asc(schema.alerta.prioridade));
      return {
        candidatos: linhas.map((l) => ({ alerta_id: l.id, tipo: l.tipo, prioridade: l.prioridade })),
        n_registros: linhas.length,
        menor_confianca: 0.95,
      };
    },
  });

  const montar = (modelo: ModeloLinguagem) =>
    new AgenteService(
      modelo,
      new RegistroFerramentas([listarCandidatos, criarSelectAlerts(db)]),
      registro,
      carregarPromptSistema(),
      { maxIteracoes: 8, maxRegeracoes: 1 },
    );

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    const donos = await db
      .insert(schema.comerciante)
      .values([{ nome: "E2E Loop A" }, { nome: "E2E Loop B" }])
      .returning();
    a = donos[0]!.id;
    b = donos[1]!.id;
    const novos = (dono: string, prioridade: number, chave: string, extra = {}) => ({
      comercianteId: dono,
      tipo: "reajuste_de_custo" as const,
      prioridade: Math.min(prioridade, 3),
      dataReferencia: DATA,
      chave,
      metricasApoio: { variacao_percentual: 12.05, custo_atual_centavos: 2790, menor_confianca: 0.95 },
      ...extra,
    });
    const linhasA = await db
      .insert(schema.alerta)
      .values([
        novos(a, 1, "p1"),
        novos(a, 2, "p2", { metricasApoio: { margem_percentual: 20.26, menor_confianca: 0.88 } }),
        novos(a, 3, "p3"),
        novos(a, 3, "p4"),
      ])
      .returning();
    alertaIds.push(...linhasA.map((l) => l.id));
    const [outroDia] = await db
      .insert(schema.alerta)
      .values(novos(a, 1, "ontem", { dataReferencia: "2026-10-18" }))
      .returning();
    alertaDeOutroDia = outroDia!.id;
    const [deB] = await db
      .insert(schema.alerta)
      .values(novos(b, 1, "b1"))
      .returning();
    alertaDeB = deB!.id;
  });

  afterAll(async () => {
    await db.delete(schema.comerciante).where(sql`${schema.comerciante.id} in (${a}, ${b})`);
    await pool.end();
  });

  const execucoesDe = (dono: string) =>
    db.select().from(schema.execucaoAgente).where(eq(schema.execucaoAgente.comercianteId, dono));

  describe("relatório diário", () => {
    it("lista, escolhe até 3 com justificativa, escreve só com números das ferramentas e registra tudo em ordem", async () => {
      const modelo = new ModeloRoteirizado([
        chamar("list_alert_candidates", {}, "t1"),
        chamar(
          "select_alerts",
          {
            alertas: [
              { alerta_id: alertaIds[0], justificativa: "Maior impacto no mês." },
              { alerta_id: alertaIds[1], justificativa: "Margem abaixo da meta." },
            ],
          },
          "t2",
        ),
        texto(
          "Bom dia! 1) O custo do arroz subiu 12,05% e agora está em R$ 27,90. 2) Margem de 20,26%, abaixo da meta.",
        ),
      ]);
      const r = await montar(modelo).executar({
        contexto: contexto(a),
        gatilho: "relatorio_diario",
        entrada: "Execução diária.",
      });
      expect(r.resultado).toBe("aprovada");

      const [execucao] = (await execucoesDe(a)).filter((e) => e.id === r.execucaoId);
      expect(execucao).toMatchObject({
        gatilho: "relatorio_diario",
        versaoPrompt: "sistema-v4",
        bloqueiosVerificador: 0,
      });
      const chamadas = await db
        .select()
        .from(schema.chamadaFerramenta)
        .where(eq(schema.chamadaFerramenta.execucaoId, r.execucaoId))
        .orderBy(asc(schema.chamadaFerramenta.ordem));
      expect(chamadas.map((c) => c.ferramenta)).toEqual(["list_alert_candidates", "select_alerts"]);
      // A justificativa da escolha fica na entrada da chamada, para a tela de bastidores.
      expect(JSON.stringify(chamadas[1]?.entrada)).toContain("Maior impacto no mês.");
      expect(chamadas[1]?.menorConfianca).toBeCloseTo(0.88);
    });

    it("número inventado no relatório é bloqueado e a versão corrigida segue", async () => {
      const modelo = new ModeloRoteirizado([
        chamar(
          "select_alerts",
          { alertas: [{ alerta_id: alertaIds[0], justificativa: "Maior impacto." }] },
          "t1",
        ),
        texto("O arroz subiu 15% e custa R$ 31,00."),
        texto("O arroz subiu 12,05% e agora custa R$ 27,90."),
      ]);
      const r = await montar(modelo).executar({
        contexto: contexto(a),
        gatilho: "relatorio_diario",
        entrada: "Execução diária.",
      });
      expect(r.resultado).toBe("aprovada");
      expect(r.mensagem).toContain("12,05%");
      const [execucao] = (await execucoesDe(a)).filter((e) => e.id === r.execucaoId);
      expect(execucao?.bloqueiosVerificador).toBe(1);
    });

    it("a justificativa do modelo não volta na saída: número escrito nela não vira fonte para o verificador", async () => {
      const r = await new RegistroFerramentas([criarSelectAlerts(db)]).executar(
        contexto(a),
        "select_alerts",
        {
          alertas: [{ alerta_id: alertaIds[0], justificativa: "O custo subiu 99% esta semana" }],
        },
      );
      expect(r.ok).toBe(true);
      // O texto do modelo não volta (conferir "99" solto falharia às vezes: o UUID do alerta pode conter "99").
      expect(JSON.stringify(r)).not.toContain("99%");
      expect(JSON.stringify(r)).not.toContain("O custo subiu");
      expect(JSON.stringify(r)).not.toContain("justificativa");

      const modelo = new ModeloRoteirizado([
        chamar(
          "select_alerts",
          { alertas: [{ alerta_id: alertaIds[0], justificativa: "O custo subiu 99% esta semana" }] },
          "t1",
        ),
        texto("O custo do arroz subiu 99%."),
        texto("O custo do arroz subiu 99%."),
      ]);
      const exec = await montar(modelo).executar({
        contexto: contexto(a),
        gatilho: "relatorio_diario",
        entrada: "Execução diária.",
      });
      expect(exec).toMatchObject({ resultado: "fallback_verificador", mensagem: FALLBACK.verificador });
    });

    it("não deixa escolher mais de 3, repetir, nem alerta de outro dia ou de outro lojista", async () => {
      const escolher = (ids: string[]) =>
        new RegistroFerramentas([criarSelectAlerts(db)]).executar(contexto(a), "select_alerts", {
          alertas: ids.map((alerta_id) => ({ alerta_id, justificativa: "x" })),
        });
      expect(await escolher(alertaIds)).toMatchObject({
        ok: false,
        erro: expect.stringMatching(/Entrada inválida/),
      });
      expect(await escolher([alertaIds[0]!, alertaIds[0]!])).toMatchObject({
        ok: false,
        erro: expect.stringMatching(/repetido/),
      });
      expect(await escolher([alertaDeB])).toMatchObject({
        ok: false,
        erro: expect.stringMatching(/Não são candidatos/),
      });
      expect(await escolher([alertaDeOutroDia])).toMatchObject({
        ok: false,
        erro: expect.stringMatching(/Não são candidatos/),
      });
      expect(await escolher(alertaIds.slice(0, 3))).toMatchObject({ ok: true });
    });

    it("sem dado nenhum, o modelo que insiste em inventar número acaba no fallback do verificador, sem número", async () => {
      const modelo = new ModeloRoteirizado([
        texto("Hoje o faturamento foi R$ 1.234,00."),
        texto("Hoje o faturamento foi R$ 1.234,00."),
      ]);
      const r = await montar(modelo).executar({
        contexto: contexto(a),
        gatilho: "mensagem_dono",
        entrada: "Quanto faturei hoje?",
      });
      expect(r).toMatchObject({ resultado: "fallback_verificador", mensagem: FALLBACK.verificador });
      expect(r.mensagem).not.toMatch(/\d/);
    });
  });

  describe("modo conversa com histórico no banco", () => {
    const gravar = (dono: string, direcao: "recebida" | "enviada", textoMsg: string, quando: string) =>
      db
        .insert(schema.mensagem)
        .values({
          comercianteId: dono,
          direcao,
          texto: textoMsg,
          dataEnvio: DATA,
          criadoEm: new Date(quando),
        })
        .returning({ id: schema.mensagem.id })
        .then((l) => l[0]!.id);

    it("carrega as últimas falas em ordem, só do comerciante da sessão, e tira a mensagem atual", async () => {
      await gravar(a, "recebida", "O arroz subiu?", "2026-10-19T12:00:00Z");
      await gravar(a, "enviada", "O arroz subiu 12,05%.", "2026-10-19T12:00:05Z");
      const atual = await gravar(a, "recebida", "E de quem foi?", "2026-10-19T12:01:00Z");
      await gravar(b, "recebida", "Mensagem de outro lojista", "2026-10-19T12:00:30Z");

      expect(await carregarHistorico(db, a, 10)).toEqual([
        { papel: "dono", texto: "O arroz subiu?" },
        { papel: "assistente", texto: "O arroz subiu 12,05%." },
        { papel: "dono", texto: "E de quem foi?" },
      ]);
      expect(await carregarHistorico(db, a, 2)).toHaveLength(2);
      expect(await carregarHistorico(db, a, 0)).toEqual([]);
      expect(await carregarHistorico(db, a, 10, atual)).toHaveLength(2);
      expect(JSON.stringify(await carregarHistorico(db, a, 10))).not.toContain("outro lojista");
    });

    it("com `mensagemAtualId`, mensagens posteriores à atual não entram no histórico (duas mensagens em fila)", async () => {
      const dono = (await db.insert(schema.comerciante).values({ nome: "E2E Loop Fila" }).returning())[0]!;
      try {
        await gravar(dono.id, "enviada", "Bom dia!", "2026-10-19T11:00:00Z");
        const primeira = await gravar(dono.id, "recebida", "Primeira pergunta", "2026-10-19T12:00:00Z");
        const segunda = await gravar(dono.id, "recebida", "Segunda pergunta", "2026-10-19T12:00:01Z");
        await gravar(dono.id, "enviada", "Resposta futura", "2026-10-19T12:00:02Z");

        // Respondendo a primeira, nem a segunda nem o que veio depois são histórico.
        expect((await carregarHistorico(db, dono.id, 10, primeira)).map((t) => t.texto)).toEqual([
          "Bom dia!",
        ]);
        // Respondendo a segunda, a primeira já é histórico e a resposta futura continua de fora.
        expect((await carregarHistorico(db, dono.id, 10, segunda)).map((t) => t.texto)).toEqual([
          "Bom dia!",
          "Primeira pergunta",
        ]);
      } finally {
        await db.delete(schema.comerciante).where(eq(schema.comerciante.id, dono.id));
      }
    });

    it("mesma data de criação: o id desempata e a mensagem atual nunca entra", async () => {
      const dono = (await db.insert(schema.comerciante).values({ nome: "E2E Loop Empate" }).returning())[0]!;
      try {
        const ids = [];
        for (const t of ["m1", "m2", "m3"])
          ids.push(await gravar(dono.id, "recebida", t, "2026-10-19T12:00:00Z"));
        const ordenados = [...ids].sort();
        const atual = ordenados[1]!;
        const historico = await carregarHistorico(db, dono.id, 10, atual);
        expect(historico).toHaveLength(1);
        const textoDoAtual = ids.indexOf(atual) === 0 ? "m1" : ids.indexOf(atual) === 1 ? "m2" : "m3";
        expect(historico.map((t) => t.texto)).not.toContain(textoDoAtual);
      } finally {
        await db.delete(schema.comerciante).where(eq(schema.comerciante.id, dono.id));
      }
    });

    it("o histórico carregado entra no pedido do agente, mas seus números não valem sem ferramenta", async () => {
      const historico = await carregarHistorico(db, a, 10);
      const sem = new ModeloRoteirizado([
        texto("Como falei, subiu 12,05%."),
        texto("Como falei, subiu 12,05%."),
      ]);
      const r = await montar(sem).executar({
        contexto: contexto(a),
        gatilho: "mensagem_dono",
        entrada: "Quanto foi mesmo?",
        historico,
      });
      expect(sem.pedidos[0]!.messages[0]!.role).toBe("user");
      expect(JSON.stringify(sem.pedidos[0]!.messages)).toContain("O arroz subiu 12,05%.");
      expect(JSON.stringify(sem.pedidos[0]!.messages)).not.toContain("outro lojista");
      expect(r).toMatchObject({ resultado: "fallback_verificador", mensagem: FALLBACK.verificador });
    });
  });
});
