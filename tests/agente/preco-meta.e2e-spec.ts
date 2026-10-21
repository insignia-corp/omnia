import type {
  BetaContentBlock,
  BetaMessage,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { AgenteService, FALLBACK } from "../../src/agente/agente.service";
import { ConfirmacaoDoDono, FALA_CONFIRMACAO } from "../../src/agente/confirmacao/confirmacao-dono";
import { ConfirmacoesPostgres } from "../../src/agente/confirmacao/confirmacoes-postgres";
import { RegistroExecucoesPostgres } from "../../src/agente/execucao/registro-execucoes";
import { criarAskOwner } from "../../src/agente/ferramentas/ask-owner";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import { criarProposeTargetPrice } from "../../src/agente/ferramentas/propose-target-price";
import {
  RegistroFerramentas,
  type ResultadoExecucaoFerramenta,
} from "../../src/agente/ferramentas/registro-ferramentas";
import { criarSaveOwnerAnswer } from "../../src/agente/ferramentas/save-owner-answer";
import type { ModeloLinguagem, PedidoModelo } from "../../src/agente/llm/modelo-linguagem";
import { carregarPromptSistema } from "../../src/agente/prompts/prompt-sistema";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";

const resposta = (stop_reason: BetaStopReason, content: unknown[]): BetaMessage =>
  ({
    id: "msg_e2e",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5-5",
    stop_reason,
    content: content as BetaContentBlock[],
    usage: {
      input_tokens: 1000,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  }) as unknown as BetaMessage;
const texto = (t: string) => resposta("end_turn", [{ type: "text", text: t }]);
const chamar = (name: string, input: unknown, id = "t1") =>
  resposta("tool_use", [{ type: "tool_use", id, name, input }]);

class ModeloRoteirizado implements ModeloLinguagem {
  readonly nome = "claude-sonnet-5-5";
  readonly pedidos: PedidoModelo[] = [];
  constructor(public respostas: BetaMessage[] = []) {}
  gerar(pedido: PedidoModelo): Promise<BetaMessage> {
    this.pedidos.push({ ...pedido, messages: structuredClone(pedido.messages) });
    const r = this.respostas.shift();
    return r ? Promise.resolve(r) : Promise.reject(new Error("Roteiro do modelo acabou"));
  }
}

describe("ação com confirmação do dono: preço-meta (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 6 });
  const db = drizzle(pool, { schema });
  const registroExec = new RegistroExecucoesPostgres(db);
  const VALIDADE_MIN = 30;
  let agora = new Date("2026-10-20T15:00:00Z");
  const comerciantes: string[] = [];

  interface Loja {
    sessao: ContextoSessao;
    produtoId: string;
    itemId: string;
  }

  async function criarLoja(nome: string, nomeProduto = "Arroz Tipo 1 5kg"): Promise<Loja> {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning();
    comerciantes.push(c!.id);
    const [forn] = await db
      .insert(schema.fornecedor)
      .values({ comercianteId: c!.id, nome: "Atacadão Teste", origem: "foto_nota" })
      .returning();
    const [prod] = await db
      .insert(schema.produto)
      .values({ comercianteId: c!.id, nome: nomeProduto, origem: "dono" })
      .returning();
    const [compra] = await db
      .insert(schema.compra)
      .values({
        comercianteId: c!.id,
        fornecedorId: forn!.id,
        data: "2026-10-10",
        totalCentavos: 1000,
        somaItensCentavos: 1000,
        origem: "foto_nota",
        confianca: 0.9,
      })
      .returning();
    const [item] = await db
      .insert(schema.itemDeCompra)
      .values({
        comercianteId: c!.id,
        compraId: compra!.id,
        produtoId: prod!.id,
        ordem: 1,
        descricaoNota: "ARROZ T1 5KG",
        quantidade: 1,
        unidade: "un",
        valorUnitarioCentavos: 1000,
        valorTotalCentavos: 1000,
        confianca: 0.9,
        origem: "foto_nota",
      })
      .returning();
    await db.insert(schema.historicoCusto).values({
      comercianteId: c!.id,
      produtoId: prod!.id,
      fornecedorId: forn!.id,
      data: "2026-10-10",
      custoUnitarioCentavos: 1000,
      itemDeCompraId: item!.id,
      origem: "foto_nota",
      confianca: 0.9,
    });
    return {
      sessao: { comercianteId: c!.id, nomeComercio: nome, dataReferencia: "2026-10-20" },
      produtoId: prod!.id,
      itemId: item!.id,
    };
  }

  /** Agente completo: registro com confirmação no banco, "sim" resolvido em código, modelo roteirizado. */
  function montar(modelo: ModeloRoteirizado) {
    const registro = new RegistroFerramentas(
      [criarAskOwner(db), criarSaveOwnerAnswer(db), criarProposeTargetPrice(db)],
      new ConfirmacoesPostgres(db, VALIDADE_MIN, () => agora),
    );
    const confirmacao = new ConfirmacaoDoDono(db, registro, () => agora);
    return new AgenteService(
      modelo,
      registro,
      registroExec,
      carregarPromptSistema(),
      { maxIteracoes: 8, maxRegeracoes: 1 },
      confirmacao,
    );
  }
  const dizer = (agente: AgenteService, loja: Loja, entrada: string) =>
    agente.executar({ contexto: loja.sessao, gatilho: "mensagem_dono", entrada });

  const produtoDe = async (loja: Loja) =>
    (await db.select().from(schema.produto).where(eq(schema.produto.id, loja.produtoId)))[0]!;
  const metasDe = (loja: Loja) =>
    db
      .select()
      .from(schema.historicoPrecoMeta)
      .where(eq(schema.historicoPrecoMeta.comercianteId, loja.sessao.comercianteId))
      .orderBy(asc(schema.historicoPrecoMeta.criadoEm), asc(schema.historicoPrecoMeta.id));
  const acoesDe = (loja: Loja) =>
    db
      .select()
      .from(schema.perguntaDono)
      .where(
        and(
          eq(schema.perguntaDono.comercianteId, loja.sessao.comercianteId),
          eq(schema.perguntaDono.tipo, "confirmar_acao"),
        ),
      )
      .orderBy(asc(schema.perguntaDono.criadoEm));

  /** O modelo propõe o preço e escreve a pergunta devolvida pela ferramenta. */
  async function propor(loja: Loja, precoCentavos: number, valorNaMensagem: string) {
    const modelo = new ModeloRoteirizado([
      chamar("propose_target_price", { produto_id: loja.produtoId, preco_meta_centavos: precoCentavos }),
      texto(
        `Quer que eu registre ${valorNaMensagem} como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.`,
      ),
    ]);
    const r = await dizer(montar(modelo), loja, `Quero o arroz a ${valorNaMensagem}`);
    return { r, modelo };
  }

  beforeAll(() => migrar(env.DATABASE_URL));
  beforeEach(() => {
    agora = new Date("2026-10-20T15:00:00Z");
  });
  afterAll(async () => {
    for (const id of comerciantes) await db.delete(schema.comerciante).where(eq(schema.comerciante.id, id));
    await pool.end();
  });

  it("propor não muda nada: só deixa a pergunta pendente, com a mensagem aprovada pelo verificador", async () => {
    const loja = await criarLoja("Loja Proposta");
    const { r } = await propor(loja, 1290, "R$ 12,90");

    expect(r.resultado).toBe("aprovada");
    expect(r.mensagem).toContain("R$ 12,90");
    expect((await produtoDe(loja)).precoMetaCentavos).toBeNull();
    expect(await metasDe(loja)).toHaveLength(0);
    const [acao] = await acoesDe(loja);
    expect(acao).toMatchObject({ status: "pendente", tipo: "confirmar_acao" });
    expect(acao!.pergunta).toBe(
      'Quer que eu registre R$ 12,90 como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.',
    );
    expect(acao!.contexto).toMatchObject({
      ferramenta: "propose_target_price",
      entrada: { produto_id: loja.produtoId, preco_meta_centavos: 1290 },
    });
  });

  it("sem o sim nada muda: outra mensagem segue para o agente, encerra a proposta e o sim tardio não aplica nada", async () => {
    const loja = await criarLoja("Loja Sem Sim");
    await propor(loja, 1290, "R$ 12,90");

    for (const fala of ["sim, mas com 15,90", "qual a margem do arroz?", "👍"]) {
      await propor(loja, 1290, "R$ 12,90");
      const modelo = new ModeloRoteirizado([texto("Não tenho dados para responder isso.")]);
      const r = await dizer(montar(modelo), loja, fala);
      expect(r.resultado).toBe("aprovada");
      expect(modelo.pedidos).toHaveLength(1);
      // A proposta só valia para a resposta imediata.
      expect((await acoesDe(loja)).at(-1)).toMatchObject({ status: "cancelada", resposta: "superada" });
    }
    expect((await produtoDe(loja)).precoMetaCentavos).toBeNull();
    expect(await metasDe(loja)).toHaveLength(0);

    // Um sim dito depois não encontra proposta e vai ao agente: nada é gravado.
    const tardio = new ModeloRoteirizado([texto("Não entendi a que você se refere.")]);
    await dizer(montar(tardio), loja, "sim");
    expect(tardio.pedidos).toHaveLength(1);
    expect(await metasDe(loja)).toHaveLength(0);
  });

  it("proposta, outra conversa no meio e só depois o sim: o sim não aplica a proposta velha", async () => {
    const loja = await criarLoja("Loja Sim Tardio");
    await propor(loja, 1290, "R$ 12,90");
    await dizer(
      montar(new ModeloRoteirizado([texto("Não tenho esse dado.")])),
      loja,
      "e o feijão, quanto custa?",
    );
    const r = await dizer(
      montar(new ModeloRoteirizado([texto("Não sei a que você se refere.")])),
      loja,
      "isso mesmo",
    );
    expect(r.mensagem).toBe("Não sei a que você se refere.");
    expect((await produtoDe(loja)).precoMetaCentavos).toBeNull();
    expect(await metasDe(loja)).toHaveLength(0);
  });

  it("o relatório diário (mensagem do sistema) também encerra a proposta pendente", async () => {
    const loja = await criarLoja("Loja Relatorio no Meio");
    await propor(loja, 1290, "R$ 12,90");
    await montar(new ModeloRoteirizado([texto("Sem alertas hoje.")])).executar({
      contexto: loja.sessao,
      gatilho: "nota_processada",
      entrada: "Nota processada.",
    });
    expect((await acoesDe(loja))[0]).toMatchObject({ status: "cancelada", resposta: "superada" });
    const r = await dizer(
      montar(new ModeloRoteirizado([texto("Não sei a que você se refere.")])),
      loja,
      "sim",
    );
    expect(r.mensagem).toBe("Não sei a que você se refere.");
    expect(await metasDe(loja)).toHaveLength(0);
  });

  it("com o sim, muda uma vez só: grava o preço, o histórico e responde sem chamar o modelo", async () => {
    const loja = await criarLoja("Loja Com Sim");
    await propor(loja, 1290, "R$ 12,90");

    const modelo = new ModeloRoteirizado();
    const r = await dizer(montar(modelo), loja, "Sim!");
    expect(r).toMatchObject({
      resultado: "aprovada",
      mensagem: 'Pronto, registrei R$ 12,90 como preço-meta de "Arroz Tipo 1 5kg".',
    });
    expect(modelo.pedidos).toHaveLength(0);

    expect((await produtoDe(loja)).precoMetaCentavos).toBe(1290);
    expect(await metasDe(loja)).toMatchObject([
      {
        precoMetaCentavos: 1290,
        anteriorCentavos: null,
        origem: "dono",
        confianca: 1,
        produtoId: loja.produtoId,
      },
    ]);
    expect((await acoesDe(loja))[0]).toMatchObject({ status: "respondida", resposta: "sim" });

    // O mesmo sim de novo não encontra proposta pendente: vai ao agente e nada muda.
    const segundo = new ModeloRoteirizado([texto("Não entendi a que você se refere.")]);
    await dizer(montar(segundo), loja, "sim");
    expect(segundo.pedidos).toHaveLength(1);
    expect(await metasDe(loja)).toHaveLength(1);
    expect((await produtoDe(loja)).precoMetaCentavos).toBe(1290);
  });

  it("a execução do sim fica registrada com a chamada confirm_pending_action, para os bastidores", async () => {
    const loja = await criarLoja("Loja Bastidores");
    await propor(loja, 990, "R$ 9,90");
    const r = await dizer(montar(new ModeloRoteirizado()), loja, "pode");

    const [execucao] = await db
      .select()
      .from(schema.execucaoAgente)
      .where(eq(schema.execucaoAgente.id, r.execucaoId));
    expect(execucao).toMatchObject({ modelo: "codigo", iteracoes: 0, resultado: "aprovada" });
    const chamadas = await db
      .select()
      .from(schema.chamadaFerramenta)
      .where(eq(schema.chamadaFerramenta.execucaoId, r.execucaoId));
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      ferramenta: "confirm_pending_action",
      entrada: { ferramenta: "propose_target_price", resposta: "sim" },
      erro: null,
    });
    expect(JSON.stringify(chamadas[0]!.saida)).toContain("executada");
  });

  it("o preço-meta anterior continua no histórico e o histórico é append-only (regra 10)", async () => {
    const loja = await criarLoja("Loja Historico");
    await propor(loja, 1290, "R$ 12,90");
    await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    await propor(loja, 1590, "R$ 15,90");
    await dizer(montar(new ModeloRoteirizado()), loja, "sim");

    expect((await produtoDe(loja)).precoMetaCentavos).toBe(1590);
    expect(await metasDe(loja)).toMatchObject([
      { precoMetaCentavos: 1290, anteriorCentavos: null },
      { precoMetaCentavos: 1590, anteriorCentavos: 1290 },
    ]);
    await expect(
      db
        .update(schema.historicoPrecoMeta)
        .set({ precoMetaCentavos: 1 })
        .where(eq(schema.historicoPrecoMeta.comercianteId, loja.sessao.comercianteId)),
    ).rejects.toThrow();
    await expect(
      db
        .delete(schema.historicoPrecoMeta)
        .where(eq(schema.historicoPrecoMeta.comercianteId, loja.sessao.comercianteId)),
    ).rejects.toThrow();
    expect(await metasDe(loja)).toHaveLength(2);
  });

  it("uma proposta nova cancela a anterior: o sim vale só para a última", async () => {
    const loja = await criarLoja("Loja Troca");
    await propor(loja, 1290, "R$ 12,90");
    await propor(loja, 1490, "R$ 14,90");
    expect((await acoesDe(loja)).map((a) => a.status)).toEqual(["cancelada", "pendente"]);

    await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    expect((await produtoDe(loja)).precoMetaCentavos).toBe(1490);
  });

  it("pedir a mesma coisa duas vezes na mesma execução reaproveita a proposta, sem duplicar", async () => {
    const loja = await criarLoja("Loja Repetida");
    const entrada = { produto_id: loja.produtoId, preco_meta_centavos: 1290 };
    const pergunta =
      'Quer que eu registre R$ 12,90 como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.';
    const modelo = new ModeloRoteirizado([
      resposta("tool_use", [
        { type: "tool_use", id: "t1", name: "propose_target_price", input: entrada },
        { type: "tool_use", id: "t2", name: "propose_target_price", input: entrada },
      ]),
      texto(pergunta),
    ]);
    await dizer(montar(modelo), loja, "Quero o arroz a R$ 12,90");
    expect(await acoesDe(loja)).toHaveLength(1);
  });

  it("não cancela a proposta e não muda nada", async () => {
    const loja = await criarLoja("Loja Nao");
    await propor(loja, 1290, "R$ 12,90");
    const r = await dizer(montar(new ModeloRoteirizado()), loja, "Não");
    expect(r.mensagem).toBe(FALA_CONFIRMACAO.cancelada);
    expect((await acoesDe(loja))[0]!.status).toBe("cancelada");
    expect((await produtoDe(loja)).precoMetaCentavos).toBeNull();
    expect(await metasDe(loja)).toHaveLength(0);
  });

  it("proposta expirada: o sim não vale, nada muda e o dono é avisado", async () => {
    const loja = await criarLoja("Loja Expirada");
    await propor(loja, 1290, "R$ 12,90");
    agora = new Date(agora.getTime() + (VALIDADE_MIN + 1) * 60_000);

    const modelo = new ModeloRoteirizado();
    const r = await dizer(montar(modelo), loja, "sim");
    expect(r.mensagem).toBe(FALA_CONFIRMACAO.expirada);
    expect(modelo.pedidos).toHaveLength(0);
    expect((await acoesDe(loja))[0]!.status).toBe("expirada");
    expect((await produtoDe(loja)).precoMetaCentavos).toBeNull();
  });

  it("dois sins ao mesmo tempo gravam uma vez só", async () => {
    const loja = await criarLoja("Loja Corrida");
    await propor(loja, 1290, "R$ 12,90");
    const duplicado = new ModeloRoteirizado([texto("Não encontrei nada pendente.")]);
    const [a, b] = await Promise.all([
      dizer(montar(new ModeloRoteirizado()), loja, "sim"),
      dizer(montar(duplicado), loja, "sim"),
    ]);
    expect(await metasDe(loja)).toHaveLength(1);
    expect([a.mensagem, b.mensagem].filter((m) => m.startsWith("Pronto, registrei"))).toHaveLength(1);
  });

  it("isolamento: o sim de outro comerciante não aplica a proposta, e produto alheio não vira proposta", async () => {
    const a = await criarLoja("Loja A");
    const b = await criarLoja("Loja B");
    await propor(a, 1290, "R$ 12,90");

    const modelo = new ModeloRoteirizado([texto("Não tenho nada pendente.")]);
    await dizer(montar(modelo), b, "sim");
    expect(modelo.pedidos).toHaveLength(1);
    expect((await produtoDe(a)).precoMetaCentavos).toBeNull();
    expect((await acoesDe(a))[0]!.status).toBe("pendente");

    const alheio = new ModeloRoteirizado([
      chamar("propose_target_price", { produto_id: a.produtoId, preco_meta_centavos: 100 }),
      texto("Não encontrei esse produto."),
    ]);
    await dizer(montar(alheio), b, "Quero o arroz a 1,00");
    expect(await acoesDe(b)).toHaveLength(0);
    expect(JSON.stringify(alheio.pedidos[1]!.messages)).toContain("Produto não encontrado");
  });

  it("valor fora da faixa ou campo extra do modelo é recusado antes de virar proposta", async () => {
    const loja = await criarLoja("Loja Entrada Invalida");
    const registro = new RegistroFerramentas(
      [criarProposeTargetPrice(db)],
      new ConfirmacoesPostgres(db, VALIDADE_MIN, () => agora),
    );
    for (const entrada of [
      { produto_id: loja.produtoId, preco_meta_centavos: 0 },
      { produto_id: loja.produtoId, preco_meta_centavos: -5 },
      { produto_id: loja.produtoId, preco_meta_centavos: 12.5 },
      { produto_id: loja.produtoId, preco_meta_centavos: 999_999_999 },
      { produto_id: loja.produtoId, preco_meta_centavos: 100, comerciante_id: "outro" },
    ]) {
      expect(await registro.executar(loja.sessao, "propose_target_price", entrada)).toMatchObject({
        ok: false,
        erro: expect.stringContaining("Entrada inválida"),
      });
    }
    expect(await acoesDe(loja)).toHaveLength(0);
  });

  it("save_owner_answer (#53) também só executa depois do sim: o custo do dono entra como linha nova", async () => {
    const loja = await criarLoja("Loja Custo");
    const modelo = new ModeloRoteirizado([
      chamar("ask_owner", { campo: "custo_unitario_produto", produto_id: loja.produtoId }, "t1"),
      texto('Qual é o custo unitário atual de "Arroz Tipo 1 5kg"? Pode responder em reais.'),
    ]);
    await dizer(montar(modelo), loja, "Qual a margem do arroz?");
    const [pergunta] = await db
      .select()
      .from(schema.perguntaDono)
      .where(
        and(
          eq(schema.perguntaDono.comercianteId, loja.sessao.comercianteId),
          eq(schema.perguntaDono.tipo, "informar_custo"),
        ),
      );

    const resposta2 = new ModeloRoteirizado([
      chamar("save_owner_answer", {
        pergunta_id: pergunta!.id,
        campo: "custo_unitario_produto",
        // O modelo repassa o que o dono escreveu; quem lê o valor e converte para centavos é o código.
        valor_informado: "12,90",
      }),
      texto('Confirma que o custo unitário atual de "Arroz Tipo 1 5kg" é R$ 12,90? Responda sim ou não.'),
    ]);
    const r2 = await dizer(montar(resposta2), loja, "12,90");
    expect(r2.resultado).toBe("aprovada");
    const custosAntes = await db
      .select()
      .from(schema.historicoCusto)
      .where(eq(schema.historicoCusto.produtoId, loja.produtoId));
    expect(custosAntes).toHaveLength(1);

    const r3 = await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    expect(r3.mensagem).toBe('Anotei R$ 12,90 como custo unitário atual de "Arroz Tipo 1 5kg".');
    const custos = await db
      .select()
      .from(schema.historicoCusto)
      .where(eq(schema.historicoCusto.produtoId, loja.produtoId))
      .orderBy(asc(schema.historicoCusto.criadoEm));
    expect(custos).toHaveLength(2);
    expect(custos[0]).toMatchObject({ custoUnitarioCentavos: 1000, origem: "foto_nota" });
    expect(custos[1]).toMatchObject({ custoUnitarioCentavos: 1290, origem: "dono", confianca: 1 });
  });

  it("falha na escrita depois do sim: fallback de erro, nada alterado e a proposta não volta a valer", async () => {
    const loja = await criarLoja("Loja Falha");
    await propor(loja, 1290, "R$ 12,90");
    // O produto some entre a proposta e o sim (ex.: exclusão a pedido do lojista).
    await db.execute(
      `update pergunta_dono set contexto = jsonb_set(contexto, '{entrada,produto_id}', '"6f1c2d3e-4a5b-4c6d-8e7f-1a2b3c4d5e6f"') where comerciante_id = '${loja.sessao.comercianteId}'`,
    );
    const r = await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    expect(r).toMatchObject({ resultado: "fallback_erro", mensagem: FALA_CONFIRMACAO.falha });
    expect(r.mensagem).not.toMatch(/\d/);
    expect((await acoesDe(loja))[0]!.status).toBe("cancelada");
    expect(await metasDe(loja)).toHaveLength(0);
    expect(FALLBACK.erro).toBeDefined();
  });

  it("se o processo cai depois de gravar e antes de confirmar, nada fica gravado e o mesmo sim ainda vale", async () => {
    const loja = await criarLoja("Loja Queda");
    await propor(loja, 1290, "R$ 12,90");

    class RegistroQueNaoTerminou extends RegistroFerramentas {
      override async executarConfirmada(
        ...args: Parameters<RegistroFerramentas["executarConfirmada"]>
      ): Promise<ResultadoExecucaoFerramenta> {
        await super.executarConfirmada(...args); // a escrita chegou a rodar...
        throw new Error("processo caiu"); // ...mas a transação não chegou ao commit
      }
    }
    const frágil = new RegistroQueNaoTerminou(
      [criarAskOwner(db), criarSaveOwnerAnswer(db), criarProposeTargetPrice(db)],
      new ConfirmacoesPostgres(db, VALIDADE_MIN, () => agora),
    );
    const agenteFragil = new AgenteService(
      new ModeloRoteirizado(),
      frágil,
      registroExec,
      carregarPromptSistema(),
      { maxIteracoes: 8, maxRegeracoes: 1 },
      new ConfirmacaoDoDono(db, frágil, () => agora),
    );
    const falhou = await dizer(agenteFragil, loja, "sim");
    expect(falhou).toMatchObject({ resultado: "fallback_erro", mensagem: FALLBACK.erro });
    expect((await produtoDe(loja)).precoMetaCentavos).toBeNull();
    expect(await metasDe(loja)).toHaveLength(0);
    expect((await acoesDe(loja))[0]!.status).toBe("pendente");

    // O dono repete o sim e agora funciona, uma vez só.
    const ok = await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    expect(ok.mensagem).toContain("Pronto, registrei R$ 12,90");
    expect(await metasDe(loja)).toHaveLength(1);
  });

  it("produto com número por extenso ou número no nome: pergunta e aviso saem completos", async () => {
    const loja = await criarLoja("Loja Nome Dificil", "Café Três Corações 500g");
    const pergunta =
      'Quer que eu registre R$ 18,90 como preço-meta de "Café Três Corações 500g"? Responda sim ou não.';
    const modelo = new ModeloRoteirizado([
      chamar("propose_target_price", { produto_id: loja.produtoId, preco_meta_centavos: 1890 }),
      texto(pergunta),
    ]);
    const proposta = await dizer(montar(modelo), loja, "Quero o café a R$ 18,90");
    expect(proposta).toMatchObject({ resultado: "aprovada", mensagem: pergunta });

    const aviso = await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    expect(aviso.mensagem).toBe('Pronto, registrei R$ 18,90 como preço-meta de "Café Três Corações 500g".');
    expect((await produtoDe(loja)).precoMetaCentavos).toBe(1890);
  });

  it("se o modelo propõe um valor e escreve outro, o dono recebe a pergunta com o valor que de fato vai gravar", async () => {
    const loja = await criarLoja("Loja Valor Trocado");
    const modelo = new ModeloRoteirizado([
      chamar("propose_target_price", { produto_id: loja.produtoId, preco_meta_centavos: 1290 }),
      // 15,90 é o que o dono escreveu, então o verificador sozinho aceitaria este texto.
      texto('Quer que eu registre R$ 15,90 como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.'),
      texto('Quer que eu registre R$ 15,90 como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.'),
    ]);
    const r = await dizer(montar(modelo), loja, "Quero o arroz a R$ 15,90");
    expect(r.mensagem).toBe(
      'Quer que eu registre R$ 12,90 como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.',
    );
    await dizer(montar(new ModeloRoteirizado()), loja, "sim");
    expect((await produtoDe(loja)).precoMetaCentavos).toBe(1290);
  });
});
