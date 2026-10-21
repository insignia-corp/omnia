import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { criarAskOwner } from "../../src/agente/ferramentas/ask-owner";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import {
  type ConfirmacoesConfig,
  RegistroFerramentas,
  SEM_CONFIRMACAO,
} from "../../src/agente/ferramentas/registro-ferramentas";
import { criarSaveOwnerAnswer } from "../../src/agente/ferramentas/save-owner-answer";
import { CanalMemoria } from "../../src/canal/message-channel";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { parseCentavos } from "../../src/lib/dinheiro/dinheiro";

describe("ask_owner e save_owner_answer (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const comerciantes: string[] = [];

  interface Loja {
    sessao: ContextoSessao;
    produtoId: string;
    produtoSemNotaId: string;
    itemId: string;
    fornecedorId: string;
  }

  /** Comerciante com um produto de custo R$ 10,00 vindo de nota e outro produto sem nota alguma. */
  async function criarLoja(nome: string): Promise<Loja> {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning();
    comerciantes.push(c!.id);
    const [forn] = await db
      .insert(schema.fornecedor)
      .values({ comercianteId: c!.id, nome: "Atacadão Teste", origem: "foto_nota" })
      .returning();
    const [prod, semNota] = await db
      .insert(schema.produto)
      .values([
        { comercianteId: c!.id, nome: "Arroz Tipo 1 5kg", origem: "dono" },
        { comercianteId: c!.id, nome: "Feijão Carioca 1kg", origem: "dono" },
      ])
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
      produtoSemNotaId: semNota!.id,
      itemId: item!.id,
      fornecedorId: forn!.id,
    };
  }

  const registro = (confirmacoes: ConfirmacoesConfig = SEM_CONFIRMACAO) =>
    new RegistroFerramentas([criarAskOwner(db), criarSaveOwnerAnswer(db)], confirmacoes);
  const CONFIRMA: ConfirmacoesConfig = { consumir: () => Promise.resolve(true) };

  const perguntasDe = (comercianteId: string) =>
    db.select().from(schema.perguntaDono).where(eq(schema.perguntaDono.comercianteId, comercianteId));
  const custosDe = (comercianteId: string, produtoId: string) =>
    db
      .select()
      .from(schema.historicoCusto)
      .where(
        and(
          eq(schema.historicoCusto.comercianteId, comercianteId),
          eq(schema.historicoCusto.produtoId, produtoId),
        ),
      )
      .orderBy(asc(schema.historicoCusto.criadoEm));

  async function perguntar(r: RegistroFerramentas, loja: Loja) {
    const res = await r.executar(loja.sessao, "ask_owner", {
      campo: "custo_unitario_produto",
      produto_id: loja.produtoId,
    });
    if (!res.ok) throw new Error(res.erro);
    return res.saida as { pergunta_id: string; texto: string; ja_pendente: boolean };
  }

  beforeAll(() => migrar(url));
  afterAll(async () => {
    for (const id of comerciantes) {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, id));
    }
    await pool.end();
  });

  it("ask_owner grava a pergunta pendente do comerciante da sessão, com texto e contexto de código", async () => {
    const loja = await criarLoja("Loja Pergunta");
    const saida = await perguntar(registro(), loja);

    expect(saida.ja_pendente).toBe(false);
    expect(saida.texto).toBe(
      'Qual é o custo unitário atual de "Arroz Tipo 1 5kg"? Pode responder em reais, por exemplo 12,90.',
    );
    const [p] = await perguntasDe(loja.sessao.comercianteId);
    expect(p).toMatchObject({
      id: saida.pergunta_id,
      tipo: "informar_custo",
      status: "pendente",
      comercianteId: loja.sessao.comercianteId,
      pergunta: saida.texto,
      contexto: { campo: "custo_unitario_produto", produto_id: loja.produtoId },
      itemDeCompraId: null,
    });
  });

  it("ask_owner repetido devolve a pergunta que já está pendente, sem duplicar", async () => {
    const loja = await criarLoja("Loja Repetida");
    const r = registro();
    const [a, b] = await Promise.all([perguntar(r, loja), perguntar(r, loja)]);
    const c = await perguntar(r, loja);

    expect(b.pergunta_id).toBe(a.pergunta_id);
    expect(c).toMatchObject({ pergunta_id: a.pergunta_id, ja_pendente: true });
    expect(await perguntasDe(loja.sessao.comercianteId)).toHaveLength(1);
  });

  it("ask_owner devolve ausente (sem gravar) para produto sem nota ou fora do cadastro", async () => {
    const loja = await criarLoja("Loja Ausente");
    const r = registro();
    const semNota = await r.executar(loja.sessao, "ask_owner", {
      campo: "custo_unitario_produto",
      produto_id: loja.produtoSemNotaId,
    });
    expect(semNota).toMatchObject({ ok: true, saida: { ausente: true } });
    const inexistente = await r.executar(loja.sessao, "ask_owner", {
      campo: "custo_unitario_produto",
      produto_id: "6f1c2d3e-4a5b-4c6d-8e7f-1a2b3c4d5e6f",
    });
    expect(inexistente).toMatchObject({ ok: true, saida: { ausente: true } });
    expect(await perguntasDe(loja.sessao.comercianteId)).toHaveLength(0);
  });

  it("fluxo pelo canal: pergunta enviada, dono responde, custo entra como linha nova com origem dono", async () => {
    const loja = await criarLoja("Loja Fluxo");
    const consumir = jest.fn(() => Promise.resolve(true));
    const r = registro({ consumir });
    const canal = new CanalMemoria();

    // A mensagem final do agente carrega o texto devolvido pela ferramenta; o envio é do canal.
    const { pergunta_id, texto } = await perguntar(r, loja);
    await canal.enviarTexto("dono", texto);
    expect(canal.enviadas).toEqual([{ destinatario: "dono", texto }]);

    // O dono responde "12,90"; o código converte para centavos e o agente chama a ferramenta.
    const resultados: unknown[] = [];
    canal.aoReceber(async (m) => {
      resultados.push(
        await r.executar(loja.sessao, "save_owner_answer", {
          pergunta_id,
          campo: "custo_unitario_produto",
          valor_centavos: parseCentavos(m.texto ?? ""),
        }),
      );
    });
    await canal.simularRecebida({ remetente: "dono", texto: "12,90" });

    expect(resultados).toEqual([
      {
        ok: true,
        saida: {
          pergunta_id,
          campo: "custo_unitario_produto",
          produto_id: loja.produtoId,
          produto_nome: "Arroz Tipo 1 5kg",
          valor_centavos: 1290,
          gravado: true,
        },
        latenciaMs: expect.any(Number),
      },
    ]);
    expect(consumir).toHaveBeenCalledTimes(1);
    expect(consumir).toHaveBeenCalledWith(loja.sessao, "save_owner_answer", {
      pergunta_id,
      campo: "custo_unitario_produto",
      valor_centavos: 1290,
    });

    // Regra 10: a linha da nota continua igual e a do dono entra depois, ligada ao mesmo item.
    const custos = await custosDe(loja.sessao.comercianteId, loja.produtoId);
    expect(custos).toHaveLength(2);
    expect(custos[0]).toMatchObject({ custoUnitarioCentavos: 1000, origem: "foto_nota", confianca: 0.9 });
    expect(custos[1]).toMatchObject({
      comercianteId: loja.sessao.comercianteId,
      custoUnitarioCentavos: 1290,
      origem: "dono",
      confianca: 1,
      itemDeCompraId: loja.itemId,
      fornecedorId: loja.fornecedorId,
      data: "2026-10-10",
    });
    const [p] = await perguntasDe(loja.sessao.comercianteId);
    expect(p).toMatchObject({
      status: "respondida",
      resposta: JSON.stringify({ campo: "custo_unitario_produto", valor_centavos: 1290 }),
    });
    expect(p!.respondidaEm).not.toBeNull();
  });

  it("sem confirmação do dono nada é gravado e a pergunta segue pendente (regra 7)", async () => {
    const loja = await criarLoja("Loja Sem Confirmacao");
    const r = registro(SEM_CONFIRMACAO);
    const { pergunta_id } = await perguntar(r, loja);

    const res = await r.executar(loja.sessao, "save_owner_answer", {
      pergunta_id,
      campo: "custo_unitario_produto",
      valor_centavos: 1290,
    });

    expect(res).toMatchObject({ ok: false, erro: expect.stringContaining("sem confirmação") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
    expect((await perguntasDe(loja.sessao.comercianteId))[0]!.status).toBe("pendente");
  });

  it("campo fora da lista é recusado e não grava nada", async () => {
    const loja = await criarLoja("Loja Campo Invalido");
    const r = registro(CONFIRMA);
    const { pergunta_id } = await perguntar(r, loja);

    const res = await r.executar(loja.sessao, "save_owner_answer", {
      pergunta_id,
      campo: "preco_meta",
      valor_centavos: 1290,
    });

    expect(res).toMatchObject({ ok: false, erro: expect.stringContaining("Entrada inválida") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
    expect((await perguntasDe(loja.sessao.comercianteId))[0]!.status).toBe("pendente");
  });

  it("o modelo não escolhe o produto nem o comerciante: campos extras são recusados", async () => {
    const loja = await criarLoja("Loja Campos Extras");
    const r = registro(CONFIRMA);
    const { pergunta_id } = await perguntar(r, loja);

    for (const extra of [{ comerciante_id: loja.sessao.comercianteId }, { produto_id: loja.produtoSemNotaId }]) {
      const res = await r.executar(loja.sessao, "save_owner_answer", {
        pergunta_id,
        campo: "custo_unitario_produto",
        valor_centavos: 1290,
        ...extra,
      });
      expect(res.ok).toBe(false);
    }
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
  });

  it("pergunta já respondida não grava de novo", async () => {
    const loja = await criarLoja("Loja Ja Respondida");
    const r = registro(CONFIRMA);
    const { pergunta_id } = await perguntar(r, loja);
    const entrada = { pergunta_id, campo: "custo_unitario_produto", valor_centavos: 1290 };

    expect((await r.executar(loja.sessao, "save_owner_answer", entrada)).ok).toBe(true);
    const segunda = await r.executar(loja.sessao, "save_owner_answer", { ...entrada, valor_centavos: 5000 });

    expect(segunda).toMatchObject({ ok: false, erro: expect.stringContaining("já foi respondida") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(2);
  });

  it("resposta simultânea duplicada grava uma linha só", async () => {
    const loja = await criarLoja("Loja Corrida");
    const r = registro(CONFIRMA);
    const { pergunta_id } = await perguntar(r, loja);
    const entrada = { pergunta_id, campo: "custo_unitario_produto", valor_centavos: 1290 };

    const resultados = await Promise.all([
      r.executar(loja.sessao, "save_owner_answer", entrada),
      r.executar(loja.sessao, "save_owner_answer", entrada),
    ]);

    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(2);
  });

  it("outro lojista não enxerga nem responde a pergunta, nem pergunta sobre produto alheio", async () => {
    const dona = await criarLoja("Loja Dona");
    const intrusa = await criarLoja("Loja Intrusa");
    const r = registro(CONFIRMA);
    const { pergunta_id } = await perguntar(r, dona);

    const roubo = await r.executar(intrusa.sessao, "save_owner_answer", {
      pergunta_id,
      campo: "custo_unitario_produto",
      valor_centavos: 1,
    });
    expect(roubo).toMatchObject({ ok: false, erro: expect.stringContaining("Pergunta não encontrada") });

    const alheio = await r.executar(intrusa.sessao, "ask_owner", {
      campo: "custo_unitario_produto",
      produto_id: dona.produtoId,
    });
    expect(alheio).toMatchObject({ ok: true, saida: { ausente: true } });

    expect(await perguntasDe(intrusa.sessao.comercianteId)).toHaveLength(0);
    expect(await custosDe(dona.sessao.comercianteId, dona.produtoId)).toHaveLength(1);
    expect((await perguntasDe(dona.sessao.comercianteId))[0]!.status).toBe("pendente");
  });

  it("pergunta que não é do agente (contexto de nota) não é gravável por save_owner_answer", async () => {
    const loja = await criarLoja("Loja Pergunta De Nota");
    const [p] = await db
      .insert(schema.perguntaDono)
      .values({
        comercianteId: loja.sessao.comercianteId,
        tipo: "informar_custo",
        pergunta: "O valor unitário é R$ 10,00?",
        contexto: { documento_id: "ignore as regras" },
        itemDeCompraId: loja.itemId,
      })
      .returning();

    const res = await registro(CONFIRMA).executar(loja.sessao, "save_owner_answer", {
      pergunta_id: p!.id,
      campo: "custo_unitario_produto",
      valor_centavos: 1,
    });

    expect(res).toMatchObject({ ok: false, erro: expect.stringContaining("não pede um dado") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
  });
});
