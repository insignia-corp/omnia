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

  /** Uma compra de um produto: a nota, o item e a linha do histórico de custo. Devolve o id do item. */
  async function comprar(
    comercianteId: string,
    fornecedorId: string,
    produtoId: string,
    data: string,
    custoCentavos: number,
  ): Promise<string> {
    const [compra] = await db
      .insert(schema.compra)
      .values({
        comercianteId,
        fornecedorId,
        data,
        totalCentavos: custoCentavos,
        somaItensCentavos: custoCentavos,
        origem: "foto_nota",
        confianca: 0.9,
      })
      .returning();
    const [item] = await db
      .insert(schema.itemDeCompra)
      .values({
        comercianteId,
        compraId: compra!.id,
        produtoId,
        ordem: 1,
        descricaoNota: "ITEM DA NOTA",
        quantidade: 1,
        unidade: "un",
        valorUnitarioCentavos: custoCentavos,
        valorTotalCentavos: custoCentavos,
        confianca: 0.9,
        origem: "foto_nota",
      })
      .returning();
    await db.insert(schema.historicoCusto).values({
      comercianteId,
      produtoId,
      fornecedorId,
      data,
      custoUnitarioCentavos: custoCentavos,
      itemDeCompraId: item!.id,
      origem: "foto_nota",
      confianca: 0.9,
    });
    return item!.id;
  }

  const novoFornecedor = async (comercianteId: string, nome: string) =>
    (await db.insert(schema.fornecedor).values({ comercianteId, nome, origem: "foto_nota" }).returning())[0]!
      .id;
  const novoProduto = async (comercianteId: string, nome: string) =>
    (await db.insert(schema.produto).values({ comercianteId, nome, origem: "dono" }).returning())[0]!.id;

  /** Comerciante com um produto de custo R$ 10,00 vindo de nota e outro produto sem nota alguma. */
  async function criarLoja(nome: string): Promise<Loja> {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning();
    comerciantes.push(c!.id);
    const fornecedorId = await novoFornecedor(c!.id, "Atacadão Teste");
    const produtoId = await novoProduto(c!.id, "Arroz Tipo 1 5kg");
    const produtoSemNotaId = await novoProduto(c!.id, "Feijão Carioca 1kg");
    const itemId = await comprar(c!.id, fornecedorId, produtoId, "2026-10-10", 1000);
    return {
      sessao: { comercianteId: c!.id, nomeComercio: nome, dataReferencia: "2026-10-20" },
      produtoId,
      produtoSemNotaId,
      itemId,
      fornecedorId,
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

  interface SaidaPergunta {
    pergunta_id: string;
    texto: string;
    ja_pendente: boolean;
  }
  async function perguntar(
    r: RegistroFerramentas,
    sessao: ContextoSessao,
    produtoId: string,
    fornecedorId?: string,
  ) {
    const res = await r.executar(sessao, "ask_owner", {
      campo: "custo_unitario_produto",
      produto_id: produtoId,
      ...(fornecedorId ? { fornecedor_id: fornecedorId } : {}),
    });
    if (!res.ok) throw new Error(res.erro);
    return res.saida as SaidaPergunta;
  }
  const salvar = (r: RegistroFerramentas, sessao: ContextoSessao, entrada: Record<string, unknown>) =>
    r.executar(sessao, "save_owner_answer", { campo: "custo_unitario_produto", ...entrada });

  beforeAll(() => migrar(url));
  afterAll(async () => {
    for (const id of comerciantes) {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, id));
    }
    await pool.end();
  });

  it("ask_owner grava a pergunta pendente do comerciante da sessão, com texto e contexto de código", async () => {
    const loja = await criarLoja("Loja Pergunta");
    const saida = await perguntar(registro(), loja.sessao, loja.produtoId);

    expect(saida.ja_pendente).toBe(false);
    expect(saida.texto).toBe('Qual é o custo unitário atual de "Arroz Tipo 1 5kg"? Pode responder em reais.');
    const [p] = await perguntasDe(loja.sessao.comercianteId);
    expect(p).toMatchObject({
      id: saida.pergunta_id,
      tipo: "informar_custo",
      status: "pendente",
      comercianteId: loja.sessao.comercianteId,
      pergunta: saida.texto,
      contexto: {
        campo: "custo_unitario_produto",
        produto_id: loja.produtoId,
        fornecedor_id: loja.fornecedorId,
      },
      itemDeCompraId: null,
    });
  });

  it("o texto devolvido pela ferramenta não traz valor de exemplo que o verificador autorizaria (regra 8)", async () => {
    const loja = await criarLoja("Loja Sem Exemplo");
    const { texto } = await perguntar(registro(), loja.sessao, loja.produtoId);
    // O único número possível é o do nome do produto, que é cadastro. Nada de "12,90".
    expect(texto.replace(/"[^"]*"/, "")).not.toMatch(/\d/);
  });

  it("ask_owner repetido devolve a pergunta que já está pendente, sem duplicar", async () => {
    const loja = await criarLoja("Loja Repetida");
    const r = registro();
    const [a, b] = await Promise.all([
      perguntar(r, loja.sessao, loja.produtoId),
      perguntar(r, loja.sessao, loja.produtoId),
    ]);
    const c = await perguntar(r, loja.sessao, loja.produtoId);

    expect(b.pergunta_id).toBe(a.pergunta_id);
    expect(c).toMatchObject({ pergunta_id: a.pergunta_id, ja_pendente: true });
    expect(await perguntasDe(loja.sessao.comercianteId)).toHaveLength(1);
  });

  it("ask_owner devolve ausente (sem gravar) para produto sem nota, fora do cadastro ou fornecedor sem compra dele", async () => {
    const loja = await criarLoja("Loja Ausente");
    const r = registro();
    const outroFornecedor = await novoFornecedor(loja.sessao.comercianteId, "Sem Compras");
    const casos = [
      { produto_id: loja.produtoSemNotaId },
      { produto_id: "6f1c2d3e-4a5b-4c6d-8e7f-1a2b3c4d5e6f" },
      { produto_id: loja.produtoId, fornecedor_id: outroFornecedor },
    ];
    for (const caso of casos) {
      const res = await r.executar(loja.sessao, "ask_owner", { campo: "custo_unitario_produto", ...caso });
      expect(res).toMatchObject({ ok: true, saida: { ausente: true } });
    }
    expect(await perguntasDe(loja.sessao.comercianteId)).toHaveLength(0);
  });

  it("com mais de um fornecedor, ask_owner pede a escolha em vez de adivinhar e a pergunta cita o fornecedor", async () => {
    const loja = await criarLoja("Loja Dois Fornecedores");
    const c = loja.sessao.comercianteId;
    const outro = await novoFornecedor(c, "Distribuidora Norte");
    await comprar(c, outro, loja.produtoId, "2026-10-15", 1100);
    const r = registro();

    const sem = await r.executar(loja.sessao, "ask_owner", {
      campo: "custo_unitario_produto",
      produto_id: loja.produtoId,
    });
    expect(sem).toMatchObject({
      ok: true,
      saida: {
        precisa_fornecedor: true,
        fornecedores: [
          { fornecedor_id: loja.fornecedorId, nome: "Atacadão Teste" },
          { fornecedor_id: outro, nome: "Distribuidora Norte" },
        ],
      },
    });
    expect(await perguntasDe(c)).toHaveLength(0);

    const com = await perguntar(r, loja.sessao, loja.produtoId, loja.fornecedorId);
    expect(com.texto).toBe(
      'Qual é o custo unitário atual de "Arroz Tipo 1 5kg" comprado de "Atacadão Teste"? Pode responder em reais.',
    );
    const [p] = await perguntasDe(c);
    expect(p!.contexto).toEqual({
      campo: "custo_unitario_produto",
      produto_id: loja.produtoId,
      fornecedor_id: loja.fornecedorId,
    });
  });

  it("a resposta fica ligada ao fornecedor da pergunta, não à compra mais recente do produto", async () => {
    const loja = await criarLoja("Loja Proveniencia");
    const c = loja.sessao.comercianteId;
    const outro = await novoFornecedor(c, "Distribuidora Norte");
    // A compra mais recente do produto é do outro fornecedor; a pergunta é sobre o primeiro.
    const itemRecente = await comprar(c, outro, loja.produtoId, "2026-10-15", 1100);
    const r = registro(CONFIRMA);
    await perguntar(r, loja.sessao, loja.produtoId, loja.fornecedorId);

    const res = await salvar(r, loja.sessao, { valor_informado: "9,50" });
    expect(res.ok).toBe(true);

    const custos = await custosDe(c, loja.produtoId);
    const doDono = custos.filter((x) => x.origem === "dono");
    expect(doDono).toHaveLength(1);
    expect(doDono[0]).toMatchObject({
      fornecedorId: loja.fornecedorId,
      itemDeCompraId: loja.itemId,
      data: "2026-10-10",
      custoUnitarioCentavos: 950,
    });
    expect(doDono[0]!.itemDeCompraId).not.toBe(itemRecente);
  });

  it("fluxo pelo canal em conversa nova: o dono responde só o valor e o código lê (sem pergunta_id nem conta do modelo)", async () => {
    const loja = await criarLoja("Loja Fluxo");
    const consumir = jest.fn(() => Promise.resolve(true));
    const r = registro({ consumir });
    const canal = new CanalMemoria();

    // A mensagem final do agente carrega o texto devolvido pela ferramenta; o envio é do canal.
    const { pergunta_id, texto } = await perguntar(r, loja.sessao, loja.produtoId);
    await canal.enviarTexto("dono", texto);
    expect(canal.enviadas).toEqual([{ destinatario: "dono", texto }]);

    // Turno novo: o modelo não tem o id e repassa o texto do dono como veio.
    const resultados: unknown[] = [];
    canal.aoReceber(async (m) => {
      resultados.push(await salvar(r, loja.sessao, { valor_informado: m.texto }));
    });
    await canal.simularRecebida({ remetente: "dono", texto: "12,90" });

    expect(resultados).toEqual([
      {
        ok: true,
        saida: {
          pergunta_id,
          campo: "custo_unitario_produto",
          produto_id: loja.produtoId,
          fornecedor_id: loja.fornecedorId,
          valor_centavos: 1290,
          valor: "R$ 12,90",
          gravado: true,
        },
        latenciaMs: expect.any(Number),
      },
    ]);
    expect(consumir).toHaveBeenCalledTimes(1);
    expect(consumir).toHaveBeenCalledWith(loja.sessao, "save_owner_answer", {
      campo: "custo_unitario_produto",
      valor_informado: "12,90",
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

  it("o código lê formatos comuns do dono: R$, milhar e ponto decimal", async () => {
    const casos: [string, number][] = [
      ["R$ 12,90", 1290],
      ["1.234,50", 123450],
      ["8", 800],
    ];
    for (const [texto, esperado] of casos) {
      const loja = await criarLoja(`Loja Formato ${texto}`);
      const r = registro(CONFIRMA);
      await perguntar(r, loja.sessao, loja.produtoId);
      expect((await salvar(r, loja.sessao, { valor_informado: texto })).ok).toBe(true);
      const custos = await custosDe(loja.sessao.comercianteId, loja.produtoId);
      expect(custos.at(-1)).toMatchObject({ origem: "dono", custoUnitarioCentavos: esperado });
    }
  });

  it("sem confirmação do dono nada é gravado e a pergunta segue pendente (regra 7)", async () => {
    const loja = await criarLoja("Loja Sem Confirmacao");
    const r = registro(SEM_CONFIRMACAO);
    await perguntar(r, loja.sessao, loja.produtoId);

    const res = await salvar(r, loja.sessao, { valor_informado: "12,90" });

    expect(res).toMatchObject({ ok: false, erro: expect.stringContaining("sem confirmação") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
    expect((await perguntasDe(loja.sessao.comercianteId))[0]!.status).toBe("pendente");
  });

  it("campo fora da lista, centavos vindos do modelo e valor ilegível são recusados e não gravam nada", async () => {
    const loja = await criarLoja("Loja Entrada Invalida");
    const r = registro(CONFIRMA);
    await perguntar(r, loja.sessao, loja.produtoId);

    const entradas = [
      { campo: "preco_meta", valor_informado: "12,90" },
      { valor_centavos: 1290 },
      { valor_informado: "12,90", valor_centavos: 1290 },
      { valor_informado: "doze reais" },
      { valor_informado: "12,90 ou 13" },
    ];
    for (const entrada of entradas) {
      const res = await salvar(r, loja.sessao, entrada);
      expect(res).toMatchObject({ ok: false, erro: expect.stringContaining("Entrada inválida") });
    }
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
    expect((await perguntasDe(loja.sessao.comercianteId))[0]!.status).toBe("pendente");
  });

  it("o modelo não escolhe o produto, o fornecedor nem o comerciante: campos extras são recusados", async () => {
    const loja = await criarLoja("Loja Campos Extras");
    const r = registro(CONFIRMA);
    await perguntar(r, loja.sessao, loja.produtoId);

    const extras = [
      { comerciante_id: loja.sessao.comercianteId },
      { produto_id: loja.produtoSemNotaId },
      { fornecedor_id: loja.fornecedorId },
    ];
    for (const extra of extras) {
      expect((await salvar(r, loja.sessao, { valor_informado: "12,90", ...extra })).ok).toBe(false);
    }
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
  });

  it("sem pergunta pendente não grava, e com pergunta_id uma pergunta já respondida não grava de novo", async () => {
    const loja = await criarLoja("Loja Ja Respondida");
    const r = registro(CONFIRMA);

    const antes = await salvar(r, loja.sessao, { valor_informado: "12,90" });
    expect(antes).toMatchObject({ ok: false, erro: expect.stringContaining("Não há pergunta pendente") });

    const { pergunta_id } = await perguntar(r, loja.sessao, loja.produtoId);
    expect((await salvar(r, loja.sessao, { pergunta_id, valor_informado: "12,90" })).ok).toBe(true);
    const segunda = await salvar(r, loja.sessao, { pergunta_id, valor_informado: "50,00" });
    const terceira = await salvar(r, loja.sessao, { valor_informado: "50,00" });

    expect(segunda).toMatchObject({ ok: false, erro: expect.stringContaining("já foi respondida") });
    expect(terceira).toMatchObject({ ok: false, erro: expect.stringContaining("Não há pergunta pendente") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(2);
  });

  it("resposta simultânea duplicada grava uma linha só", async () => {
    const loja = await criarLoja("Loja Corrida");
    const r = registro(CONFIRMA);
    await perguntar(r, loja.sessao, loja.produtoId);

    const resultados = await Promise.all([
      salvar(r, loja.sessao, { valor_informado: "12,90" }),
      salvar(r, loja.sessao, { valor_informado: "12,90" }),
    ]);

    expect(resultados.filter((x) => x.ok)).toHaveLength(1);
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(2);
  });

  it("com duas perguntas pendentes, a ferramenta devolve a lista em vez de escolher; com o id, grava na certa", async () => {
    const loja = await criarLoja("Loja Duas Pendentes");
    const c = loja.sessao.comercianteId;
    const macarrao = await novoProduto(c, "Macarrão 500g");
    await comprar(c, loja.fornecedorId, macarrao, "2026-10-12", 400);
    const r = registro(CONFIRMA);
    const arroz = await perguntar(r, loja.sessao, loja.produtoId);
    const massa = await perguntar(r, loja.sessao, macarrao);

    const ambigua = await salvar(r, loja.sessao, { valor_informado: "4,50" });
    expect(ambigua).toMatchObject({ ok: false, erro: expect.stringContaining("2 perguntas pendentes") });
    expect(ambigua.ok ? "" : ambigua.erro).toContain(arroz.pergunta_id);
    expect(ambigua.ok ? "" : ambigua.erro).toContain(massa.pergunta_id);
    expect(await custosDe(c, loja.produtoId)).toHaveLength(1);
    expect(await custosDe(c, macarrao)).toHaveLength(1);

    expect(
      (await salvar(r, loja.sessao, { pergunta_id: massa.pergunta_id, valor_informado: "4,50" })).ok,
    ).toBe(true);
    expect((await custosDe(c, macarrao)).at(-1)).toMatchObject({
      origem: "dono",
      custoUnitarioCentavos: 450,
    });
    expect(await custosDe(c, loja.produtoId)).toHaveLength(1);
  });

  it("outro lojista não enxerga nem responde a pergunta, nem pergunta sobre produto alheio", async () => {
    const dona = await criarLoja("Loja Dona");
    const intrusa = await criarLoja("Loja Intrusa");
    const r = registro(CONFIRMA);
    const { pergunta_id } = await perguntar(r, dona.sessao, dona.produtoId);

    const comId = await salvar(r, intrusa.sessao, { pergunta_id, valor_informado: "0,01" });
    expect(comId).toMatchObject({ ok: false, erro: expect.stringContaining("Pergunta não encontrada") });
    const semId = await salvar(r, intrusa.sessao, { valor_informado: "0,01" });
    expect(semId).toMatchObject({ ok: false, erro: expect.stringContaining("Não há pergunta pendente") });

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
    const r = registro(CONFIRMA);

    const comId = await salvar(r, loja.sessao, { pergunta_id: p!.id, valor_informado: "0,01" });
    expect(comId).toMatchObject({ ok: false, erro: expect.stringContaining("não pede um dado") });
    const semId = await salvar(r, loja.sessao, { valor_informado: "0,01" });
    expect(semId).toMatchObject({ ok: false, erro: expect.stringContaining("Não há pergunta pendente") });
    expect(await custosDe(loja.sessao.comercianteId, loja.produtoId)).toHaveLength(1);
  });
});
