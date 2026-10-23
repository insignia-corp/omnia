import type {
  BetaContentBlock,
  BetaMessage,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import {
  MODELO_LINGUAGEM,
  type ModeloLinguagem,
  type PedidoModelo,
} from "../../src/agente/llm/modelo-linguagem";
import { FALLBACK } from "../../src/agente/agente.service";
import { RELOGIO, type Relogio } from "../../src/canal/relogio";
import { COMERCIANTE_DEMO } from "../../src/canal/web/whatsapp.controller";
import { TEXTO_PERGUNTA_JA_RESPONDIDA, TEXTO_SEM_PRODUTO } from "../../src/canal/whatsapp/perguntas-da-nota";
import { TEXTO_CANCELAR, TEXTO_SEM_PROPOSTA, TEXTO_SEM_RESPOSTA } from "../../src/canal/whatsapp/respostas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { carregarFixtures } from "../../src/infra/database/seed/carregar-fixtures";
import { montarSeed } from "../../src/infra/database/seed/montar-seed";
import { comerciantesDoSeed } from "../../src/infra/database/seed/semear";
import type { ClienteVisao } from "../../src/ingestao/extracao/cliente-visao";
import { CLIENTE_VISAO } from "../../src/ingestao/ingestao.module";

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
const chamar = (name: string, input: unknown) =>
  resposta("tool_use", [{ type: "tool_use", id: "t1", name, input }]);

/** Segue um roteiro de respostas; sem roteiro, responde sempre o mesmo texto (sem números). */
class ModeloRoteirizado implements ModeloLinguagem {
  readonly nome = "claude-sonnet-5-5";
  readonly pedidos: PedidoModelo[] = [];
  roteiro: BetaMessage[] = [];
  atrasoMs = 0;
  async gerar(pedido: PedidoModelo): Promise<BetaMessage> {
    this.pedidos.push({ ...pedido, messages: structuredClone(pedido.messages) });
    if (this.atrasoMs > 0) await new Promise((r) => setTimeout(r, this.atrasoMs));
    return this.roteiro.shift() ?? texto("Tudo certo por aqui. Sigo de olho no seu negócio.");
  }
}

interface MensagemWa {
  id: string;
  direcao: "entrada" | "saida";
  type: string;
  status?: string;
  context?: { id: string };
  text?: { body: string };
  image?: { id: string; caption?: string; mime_type?: string };
  document?: { id: string; filename: string };
  template?: { name: string; components: { type: string; parameters: { text?: string }[] }[] };
  interactive?: {
    type: string;
    header?: { text: string };
    body: { text: string };
    action: {
      buttons?: { reply: { id: string; title: string } }[];
      sections?: { rows: { id: string }[] }[];
      parameters?: { url: string };
    };
  };
}

const idsDosBotoes = (m: MensagemWa | undefined) => m?.interactive?.action.buttons?.map((b) => b.reply.id);
const textoDo = (pedido: PedidoModelo) => JSON.stringify(pedido.messages.at(-1)?.content);
const corpoDe = (m: MensagemWa | undefined) => m?.text?.body ?? m?.interactive?.body.text ?? "";

describe("WhatsApp simulado integrado (e2e, issue #182)", () => {
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-e2e-whatsapp-"));
  const modelo = new ModeloRoteirizado();
  // A leitura da foto roda em segundo plano; aqui só importa o que o dono vê na hora.
  const visao: ClienteVisao = { extrair: () => Promise.reject(new Error("fora do escopo deste teste")) };
  // 2026-10-20 11:00 em São Paulo: fora do silêncio, dia seguinte ao fim das vendas de teste.
  const relogio: Relogio = { agora: () => new Date("2026-10-20T14:00:00Z") };

  let app: INestApplication;
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const ids: string[] = [];

  const servidor = () => app.getHttpServer() as Parameters<typeof request>[0];
  const como = (id: string) => ({ "X-Comerciante-Id": id });
  const novoComerciante = async (nome: string) => {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning({ id: schema.comerciante.id });
    ids.push(c!.id);
    return c!.id;
  };
  const enviar = async (comercianteId: string, corpo: object) =>
    (await request(servidor()).post("/chat/mensagens").set(como(comercianteId)).send(corpo).expect(200))
      .body as {
      mensagens: MensagemWa[];
    };
  const textoDoDono = (body: string, id = `wamid.dono${randomUUID()}`) => ({
    id,
    type: "text",
    text: { body },
  });
  const tocar = (
    id: string,
    title: string,
    citada: string,
    tipo: "button_reply" | "list_reply" = "button_reply",
  ) => ({
    id: `wamid.dono${randomUUID()}`,
    type: "interactive",
    interactive: { type: tipo, [tipo]: { id, title } },
    context: { id: citada },
  });
  const listar = async (comercianteId: string) =>
    (await request(servidor()).get("/chat/mensagens?formato=whatsapp").set(como(comercianteId)).expect(200))
      .body as { mensagens: MensagemWa[]; digitando: boolean; janela_aberta: boolean };

  beforeAll(async () => {
    process.env.ARMAZENAMENTO_DIR = dirArquivos;
    const env = carregarEnv();
    await migrar(env.DATABASE_URL);
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MODELO_LINGUAGEM)
      .useValue(modelo)
      .overrideProvider(CLIENTE_VISAO)
      .useValue(visao)
      .overrideProvider(RELOGIO)
      .useValue(relogio)
      .compile();
    app = modulo.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (ids.length) {
      await db.transaction(async (tx) => {
        // Libera o DELETE do histórico append-only (preço-meta) só nesta transação, como o seed.
        await tx.execute(`SET LOCAL omnia.exclusao_autorizada = 'on'`);
        await tx.delete(schema.comerciante).where(inArray(schema.comerciante.id, ids));
      });
    }
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  beforeEach(() => {
    modelo.roteiro = [];
    modelo.atrasoMs = 0;
  });

  describe("front servido pelo Nest", () => {
    it("redireciona para a barra final mantendo a consulta e serve a página", async () => {
      const r = await request(servidor()).get("/whatsapp?modo=demo").expect(302);
      expect(r.headers.location).toBe("/whatsapp/?modo=demo");
      const pagina = await request(servidor()).get("/whatsapp/").expect(200);
      expect(pagina.headers["content-type"]).toMatch(/text\/html/);
      expect(pagina.text).toContain("Omnia no WhatsApp");
    });

    it("serve os módulos da pasta e nada fora dela", async () => {
      for (const arquivo of ["app.js", "transporte-api.js", "transporte-demo.js", "estilo.css"]) {
        const r = await request(servidor()).get(`/whatsapp/${arquivo}`).expect(200);
        expect(r.headers["content-type"]).toMatch(/javascript|css/);
      }
      for (const fora of ["package.json", "testes", "..%2F..%2Fpackage.json", "README.md", "nao-existe.js"]) {
        await request(servidor()).get(`/whatsapp/${fora}`).expect(404);
      }
    });

    it("a sessão devolve o comerciante informado, e o da demo é o do seed", async () => {
      const c = await novoComerciante("E2E WhatsApp sessão");
      const r = await request(servidor()).get(`/whatsapp/sessao?comerciante=${c}`).expect(200);
      expect(r.body).toEqual({ comerciante_id: c, nome: "E2E WhatsApp sessão" });
      await request(servidor()).get(`/whatsapp/sessao?comerciante=${randomUUID()}`).expect(404);
      await request(servidor()).get("/whatsapp/sessao?comerciante=nao-uuid").expect(404);
      const [vilaNova] = comerciantesDoSeed(carregarFixtures());
      expect(montarSeed(vilaNova!.dados, vilaNova!.opcoes).comerciante.id).toBe(COMERCIANTE_DEMO);
    });
  });

  describe("conversa no formato da Cloud API", () => {
    it("oi abre o menu em lista sem chamar o modelo, e a mensagem do dono fica lida", async () => {
      const c = await novoComerciante("Mercadinho E2E");
      const antes = modelo.pedidos.length;
      const { mensagens } = await enviar(c, textoDoDono("Oi!"));
      expect(modelo.pedidos.length).toBe(antes);
      expect(mensagens.map((m) => [m.direcao, m.type])).toEqual([
        ["entrada", "text"],
        ["saida", "interactive"],
      ]);
      expect(mensagens[0]!.status).toBe("read");
      expect(mensagens[1]!.interactive!.type).toBe("list");
      expect(mensagens[1]!.interactive!.body.text).toContain("Mercadinho E2E");
    });

    it("linha da lista vai ao agente pelo pedido da ação, e a resposta verificada ganha os botões seguintes", async () => {
      const c = await novoComerciante("E2E WhatsApp resumo");
      const menu = (await enviar(c, textoDoDono("menu"))).mensagens[1]!;
      const { mensagens } = await enviar(
        c,
        tocar("resumo_semana", "Resumo da semana", menu.id, "list_reply"),
      );
      expect(textoDo(modelo.pedidos.at(-1)!)).toContain("Resumo da semana");
      const [dono, resposta] = mensagens;
      expect(dono).toMatchObject({
        direcao: "entrada",
        type: "interactive",
        context: { id: menu.id },
        status: "read",
      });
      expect(resposta!.interactive!.body.text).toBe("Tudo certo por aqui. Sigo de olho no seu negócio.");
      expect(idsDosBotoes(resposta)).toEqual(["resumo_mes", "avisos", "menu"]);
    });

    it("texto livre vai ao agente e volta como texto puro", async () => {
      const c = await novoComerciante("E2E WhatsApp texto");
      const { mensagens } = await enviar(c, textoDoDono("Como está o caixa?"));
      expect(mensagens[1]).toMatchObject({
        type: "text",
        text: { body: expect.stringContaining("Tudo certo") },
      });
    });

    it("a segunda mensagem chega ao agente com a primeira conversa no histórico, e só a deste comerciante", async () => {
      const c = await novoComerciante("E2E WhatsApp memória A");
      const outro = await novoComerciante("E2E WhatsApp memória B");
      await enviar(outro, textoDoDono("Segredo do outro lojista: caixa 777"));
      await enviar(c, textoDoDono("Como foi o mês passado?"));
      await enviar(c, textoDoDono("e do mês?"));
      const pedido = modelo.pedidos.at(-1)!;
      const mensagens = JSON.stringify(pedido.messages);
      // O turno anterior (pergunta e resposta) vem do banco antes da pergunta nova, que fica por último.
      expect(mensagens).toContain("Como foi o mês passado?");
      expect(mensagens).toContain("Tudo certo por aqui");
      expect(mensagens.indexOf("Como foi o mês passado?")).toBeLessThan(mensagens.indexOf("e do mês?"));
      expect(textoDo(pedido)).toContain("e do mês?");
      expect(textoDo(pedido)).not.toContain("Como foi o mês passado?");
      // Nada do outro comerciante, nem a mensagem atual repetida no histórico.
      expect(mensagens).not.toContain("Segredo do outro lojista");
      expect(mensagens.split("e do mês?").length - 1).toBe(1);
    });

    it("primeira mensagem do comerciante chega sem histórico", async () => {
      const c = await novoComerciante("E2E WhatsApp memória vazia");
      await enviar(c, textoDoDono("Como está o caixa hoje?"));
      expect(modelo.pedidos.at(-1)!.messages).toHaveLength(1);
    });

    it("texto livre que o verificador barra até o fim abre o menu sem número; botão e erro seguem como antes", async () => {
      const c = await novoComerciante("E2E WhatsApp sem resposta");
      // Número que nenhuma ferramenta devolveu: o verificador bloqueia todas as tentativas.
      const inventada = () => Array.from({ length: 12 }, () => texto("Você faturou 98765 reais ontem."));
      modelo.roteiro = inventada();
      const livre = await enviar(c, textoDoDono("Quanto faturei ontem?"));
      const saida = livre.mensagens[1]!;
      expect(saida.interactive!.type).toBe("list");
      expect(saida.interactive!.body.text).toBe(TEXTO_SEM_RESPOSTA);
      // Regra 8: a abertura é fixa e não leva número.
      expect(TEXTO_SEM_RESPOSTA).not.toMatch(/\d/);
      expect(JSON.stringify(saida)).not.toContain("98765");
      const [gravada] = await db
        .select({ execucaoId: schema.mensagem.execucaoId })
        .from(schema.mensagem)
        .where(and(eq(schema.mensagem.comercianteId, c), eq(schema.mensagem.direcao, "enviada")))
        .orderBy(schema.mensagem.criadoEm);
      expect(gravada?.execucaoId).not.toBeNull();

      // Mesmo bloqueio depois de um toque em botão: continua a frase do verificador, não o menu.
      modelo.roteiro = inventada();
      const menuAnterior = (await enviar(c, textoDoDono("menu"))).mensagens[1]!;
      const botao = await enviar(
        c,
        tocar("resumo_semana", "Resumo da semana", menuAnterior.id, "list_reply"),
      );
      const respostaBotao = botao.mensagens[1]!;
      expect(corpoDe(respostaBotao)).toBe(FALLBACK.verificador);
      expect(respostaBotao.interactive?.type).toBe("button");
    });

    it("reentrega do mesmo id devolve as mesmas mensagens sem rodar o agente de novo", async () => {
      const c = await novoComerciante("E2E WhatsApp reentrega");
      const m = textoDoDono("Quanto vendi?");
      const primeira = await enviar(c, m);
      const antes = modelo.pedidos.length;
      const segunda = await enviar(c, m);
      expect(modelo.pedidos.length).toBe(antes);
      expect(segunda.mensagens.map((x) => x.id)).toEqual(primeira.mensagens.map((x) => x.id));
    });

    it("o histórico traz status, digitando enquanto o agente roda e a janela de 24 h", async () => {
      const c = await novoComerciante("E2E WhatsApp digitando");
      expect((await listar(c)).janela_aberta).toBe(false);
      modelo.atrasoMs = 1500;
      const envio = enviar(c, textoDoDono("Pergunta demorada"));
      let viuDigitando = false;
      const limite = Date.now() + 5000;
      while (!viuDigitando && Date.now() < limite) {
        viuDigitando = (await listar(c)).digitando;
        if (!viuDigitando) await new Promise((r) => setTimeout(r, 100));
      }
      await envio;
      expect(viuDigitando).toBe(true);
      const depois = await listar(c);
      expect(depois.digitando).toBe(false);
      expect(depois.janela_aberta).toBe(true);
      expect(depois.mensagens.map((m) => m.direcao)).toEqual(["entrada", "saida"]);
      expect(depois.mensagens[0]!.status).toBe("read");
    });

    it("um comerciante não vê as mensagens do outro", async () => {
      const a = await novoComerciante("E2E WhatsApp A");
      const b = await novoComerciante("E2E WhatsApp B");
      await enviar(a, textoDoDono("oi"));
      expect((await listar(b)).mensagens).toEqual([]);
    });

    it("painel e como enviar nota são mensagens fixas; o link do painel leva o comerciante da sessão", async () => {
      const c = await novoComerciante("E2E WhatsApp painel");
      const menu = (await enviar(c, textoDoDono("menu"))).mensagens[1]!;
      const antes = modelo.pedidos.length;
      const painel = (await enviar(c, tocar("painel", "Abrir painel", menu.id, "list_reply"))).mensagens[1]!;
      expect(painel.interactive).toMatchObject({
        type: "cta_url",
        action: { parameters: { url: `/painel/?comerciante=${c}` } },
      });
      const nota = (await enviar(c, tocar("como_nota", "Enviar nota fiscal", menu.id, "list_reply")))
        .mensagens[1]!;
      expect(nota.text!.body).toContain("XML da NF-e");
      expect(modelo.pedidos.length).toBe(antes);
    });

    it("'Agora não' e 'Sim, guardar' sem proposta pendente respondem sem chamar o modelo", async () => {
      const c = await novoComerciante("E2E WhatsApp cancelar");
      const antes = modelo.pedidos.length;
      const r = await enviar(c, {
        id: `wamid.dono${randomUUID()}`,
        type: "button",
        button: { payload: "cancelar", text: "Agora não" },
      });
      expect(r.mensagens[1]!.text!.body).toBe(TEXTO_CANCELAR);
      const sim = await enviar(c, tocar("confirmar_preco", "Sim, guardar", r.mensagens[1]!.id));
      expect(sim.mensagens[1]!.text!.body).toBe(TEXTO_SEM_PROPOSTA);
      expect(modelo.pedidos.length).toBe(antes);
    });

    it("proposta de preço-meta ganha os botões de confirmação e só grava depois do sim (regra 7)", async () => {
      const c = await novoComerciante("E2E WhatsApp preço");
      const [p] = await db
        .insert(schema.produto)
        .values({ comercianteId: c, nome: "Arroz Tipo 1 5kg", origem: "dono" })
        .returning({ id: schema.produto.id });
      modelo.roteiro = [
        chamar("propose_target_price", { produto_id: p!.id, preco_meta_centavos: 3720 }),
        texto('Quer que eu registre R$ 37,20 como preço-meta de "Arroz Tipo 1 5kg"? Responda sim ou não.'),
      ];
      const proposta = (await enviar(c, textoDoDono("Sugira um preço para o arroz"))).mensagens[1]!;
      expect(idsDosBotoes(proposta)).toEqual(["confirmar_preco", "cancelar"]);
      const historico = () =>
        db.select().from(schema.historicoPrecoMeta).where(eq(schema.historicoPrecoMeta.comercianteId, c));
      expect(await historico()).toHaveLength(0);

      const antes = modelo.pedidos.length;
      const sim = (await enviar(c, tocar("confirmar_preco", "Sim, guardar", proposta.id))).mensagens[1]!;
      expect(modelo.pedidos.length).toBe(antes);
      expect(sim.text!.body).toContain("registrei R$ 37,20");
      expect((await historico()).map((h) => h.precoMetaCentavos)).toEqual([3720]);
    });

    it("recusa corpo fora do formato, inclusive com comerciante_id no corpo", async () => {
      const c = await novoComerciante("E2E WhatsApp inválido");
      for (const corpo of [
        { id: "x", type: "text", text: { body: "oi" } },
        { ...textoDoDono("oi"), comerciante_id: c },
        { id: "wamid.dono1234", type: "image", image: { id: "x" } },
        { id_externo: randomUUID(), texto: "a".repeat(4097) },
      ]) {
        await request(servidor()).post("/chat/mensagens").set(como(c)).send(corpo).expect(400);
      }
    });
  });

  describe("nota pela conversa", () => {
    it("perguntas da nota saem com o id delas e a resposta tocada vai ao resolvedor, sem modelo", async () => {
      // Catálogo vazio: nenhum item da nota 18 liga sozinho, e cada um vira pergunta de vínculo.
      const c = await novoComerciante("E2E WhatsApp perguntas");
      const r = await request(servidor())
        .post("/chat/notas")
        .set(como(c))
        .attach("arquivo", readFileSync("fixtures/notas/nota-18.xml"), {
          filename: "nota-18.xml",
          contentType: "application/xml",
        })
        .field("id", "wamid.donoperguntas")
        .expect(202);
      const listas = (r.body as { mensagens: MensagemWa[] }).mensagens.filter(
        (m) => m.interactive?.type === "list",
      );
      expect(listas.length).toBeGreaterThanOrEqual(2);
      const linhas = listas[0]!.interactive!.action.sections![0]!.rows.map((l) => l.id);
      const perguntaId = /^pergunta:([0-9a-f-]{36}):nao$/.exec(linhas.at(-1)!)![1]!;
      const [pergunta] = await db
        .select()
        .from(schema.perguntaDono)
        .where(eq(schema.perguntaDono.id, perguntaId));
      expect(pergunta).toMatchObject({ comercianteId: c, tipo: "confirmar_vinculo", status: "pendente" });

      const [p] = await db
        .insert(schema.produto)
        .values({ comercianteId: c, nome: "Pão de forma 500g", origem: "dono" })
        .returning({ id: schema.produto.id });
      const antes = modelo.pedidos.length;
      const escolha = (id: string) => tocar(id, "Pão de forma 500g", listas[0]!.id, "list_reply");
      const ligou = await enviar(c, escolha(`pergunta:${perguntaId}:produto:${p!.id}`));
      expect(ligou.mensagens[1]!.text!.body).toMatch(/^Anotado/);
      const [item] = await db
        .select()
        .from(schema.itemDeCompra)
        .where(eq(schema.itemDeCompra.id, pergunta!.itemDeCompraId!));
      expect(item!.produtoId).toBe(p!.id);
      const [respondida] = await db
        .select()
        .from(schema.perguntaDono)
        .where(eq(schema.perguntaDono.id, perguntaId));
      expect(respondida!.status).toBe("respondida");

      const deNovo = await enviar(c, escolha(`pergunta:${perguntaId}:produto:${p!.id}`));
      expect(deNovo.mensagens[1]!.text!.body).toBe(TEXTO_PERGUNTA_JA_RESPONDIDA);
      const outra = /^pergunta:([0-9a-f-]{36}):nao$/.exec(
        listas[1]!.interactive!.action.sections![0]!.rows.at(-1)!.id,
      )![1]!;
      const nenhum = await enviar(
        c,
        tocar(`pergunta:${outra}:nao`, "Nenhum desses", listas[1]!.id, "list_reply"),
      );
      expect(nenhum.mensagens[1]!.text!.body).toBe(TEXTO_SEM_PRODUTO);
      expect(modelo.pedidos.length).toBe(antes);
    });

    it("XML da NF-e: a mensagem do dono é o documento e a leitura chega na hora", async () => {
      const c = await novoComerciante("E2E WhatsApp XML");
      const xml = readFileSync("fixtures/notas/nota-18.xml");
      const r = await request(servidor())
        .post("/chat/notas")
        .set(como(c))
        .attach("arquivo", xml, { filename: "nota-18.xml", contentType: "application/xml" })
        .field("id", "wamid.donoxml18")
        .field("nome_arquivo", "nota-18.xml")
        .expect(202);
      const corpo = r.body as { status: string; duplicado: boolean; mensagens: MensagemWa[] };
      expect(corpo.duplicado).toBe(false);
      const [dono, recebi, lida, ...perguntas] = corpo.mensagens;
      expect(dono).toMatchObject({
        id: "wamid.donoxml18",
        type: "document",
        document: { filename: "nota-18.xml" },
      });
      expect(recebi!.text!.body).toMatch(/Recebi o XML/);
      // A leitura vem montada do banco; sem dúvida, com botões e cabeçalho; com dúvida, seguida das perguntas.
      expect(corpoDe(lida)).toMatch(/^Li a nota da \*/);
      expect(corpoDe(lida)).toMatch(/\*Total: R\$ [\d.]+,\d{2}\*/);
      if (lida!.type === "interactive") expect(lida!.interactive!.header!.text).toBe("Nota lida");
      else expect(perguntas.length).toBeGreaterThan(0);
      expect(perguntas.length).toBeLessThanOrEqual(3);

      const arquivo = await request(servidor())
        .get(`/chat/notas/${dono!.document!.id}/arquivo`)
        .set(como(c))
        .expect(200);
      expect(arquivo.headers["content-type"]).toMatch(/xml/);
      expect(arquivo.headers["content-disposition"]).toBe("attachment");

      // O mesmo arquivo de novo não conta duas vezes: o dono recebe a leitura que já estava guardada.
      const repetida = await request(servidor())
        .post("/chat/notas")
        .set(como(c))
        .attach("arquivo", xml, { filename: "nota-18.xml", contentType: "application/xml" })
        .field("id", "wamid.donoxml18b")
        .expect(202);
      const msgs = (repetida.body as { duplicado: boolean; mensagens: MensagemWa[] }).mensagens;
      expect((repetida.body as { duplicado: boolean }).duplicado).toBe(true);
      expect(msgs.at(-1)!.interactive!.body.text).toMatch(/^Esta nota já estava no seu histórico/);
    });

    it("foto: a mensagem do dono leva legenda e a foto, que só o próprio comerciante baixa", async () => {
      const c = await novoComerciante("E2E WhatsApp foto");
      const outro = await novoComerciante("E2E WhatsApp foto outro");
      const foto = readFileSync("fixtures/notas/nota-02.jpg");
      const r = await request(servidor())
        .post("/chat/notas")
        .set(como(c))
        .attach("arquivo", foto, { filename: "nota-02.jpg", contentType: "image/jpeg" })
        .field("id", "wamid.donofoto02")
        .field("legenda", "nota do arroz")
        .expect(202);
      const [dono, aviso] = (r.body as { mensagens: MensagemWa[] }).mensagens;
      expect(dono).toMatchObject({
        type: "image",
        status: "read",
        image: { caption: "nota do arroz", mime_type: "image/jpeg" },
      });
      expect(aviso!.text!.body).toMatch(/Recebi a foto da nota/);
      const baixada = await request(servidor())
        .get(`/chat/notas/${dono!.image!.id}/arquivo`)
        .set(como(c))
        .expect(200);
      expect(baixada.headers["content-type"]).toBe("image/jpeg");
      expect(baixada.headers["x-content-type-options"]).toBe("nosniff");
      expect(baixada.headers["content-security-policy"]).toContain("sandbox");
      await request(servidor()).get(`/chat/notas/${dono!.image!.id}/arquivo`).set(como(outro)).expect(404);
    });
  });

  describe("resumo das 7h (regra 9 e janela de 24 h)", () => {
    /** Vendas de 8 dias até 2026-10-19: o resumo do dia anterior e a média dos 7 dias existem. */
    async function comVendas(nome: string) {
      const c = await novoComerciante(nome);
      const dias = Array.from({ length: 8 }, (_, i) => `2026-10-${String(12 + i).padStart(2, "0")}`);
      await db.insert(schema.venda).values(
        dias.flatMap((data, i) => [
          { comercianteId: c, data, numeroCupom: `${data}-1`, totalCentavos: 10_000 },
          // O último dia vende o dobro: 100% acima da média.
          { comercianteId: c, data, numeroCupom: `${data}-2`, totalCentavos: i === 7 ? 30_000 : 10_000 },
        ]),
      );
      return c;
    }

    it("fora da janela sai o modelo resumo_diario com números das métricas, e só um por dia", async () => {
      const c = await comVendas("E2E WhatsApp modelo");
      const antes = modelo.pedidos.length;
      const r = await request(servidor()).post("/chat/proativa").set(como(c)).expect(200);
      expect(r.body).toEqual({ resultado: "enviada", aviso: null });
      expect(modelo.pedidos.length).toBe(antes);
      const [m] = (await listar(c)).mensagens;
      expect(m!.template!.name).toBe("resumo_diario");
      expect(m!.template!.components[0]!.parameters.map((p) => p.text)).toEqual([
        "segunda, 19/10",
        "E2E WhatsApp modelo",
        "R$ 400,00",
        "2",
        "100% acima",
        "0",
      ]);
      const segunda = await request(servidor()).post("/chat/proativa").set(como(c)).expect(200);
      expect(segunda.body).toMatchObject({
        resultado: "ja_enviada_hoje",
        aviso: expect.stringContaining("1 mensagem"),
      });
      expect((await listar(c)).mensagens).toHaveLength(1);
    });

    it("dentro da janela o relatório é o texto verificado do agente, com botões", async () => {
      const c = await comVendas("E2E WhatsApp janela");
      await enviar(c, textoDoDono("oi"));
      const r = await request(servidor()).post("/chat/proativa").set(como(c)).expect(200);
      expect(r.body).toEqual({ resultado: "enviada", aviso: null });
      const ultima = (await listar(c)).mensagens.at(-1)!;
      expect(ultima.type).toBe("interactive");
      expect(idsDosBotoes(ultima)).toEqual(["avisos", "resumo_semana", "menu"]);
    });

    it("sem dado para o modelo, nada sai", async () => {
      const c = await novoComerciante("E2E WhatsApp sem vendas");
      const r = await request(servidor()).post("/chat/proativa").set(como(c)).expect(200);
      expect(r.body.resultado).toBe("sem_dados");
      const proativas = await db
        .select()
        .from(schema.mensagem)
        .where(and(eq(schema.mensagem.comercianteId, c), eq(schema.mensagem.proativa, true)));
      expect(proativas).toHaveLength(0);
    });
  });

  describe("painel", () => {
    it("a página abre sem sessão e os dados pedem o comerciante", async () => {
      const pagina = await request(servidor()).get("/painel/").expect(200);
      expect(pagina.text).toContain("Painel do Omnia");
      await request(servidor()).get("/painel/dados").expect(401);
    });

    it("os dados trazem o resumo do dia, da semana e do mês, com dado ausente em vez de zero", async () => {
      const c = await novoComerciante("E2E WhatsApp painel dados");
      await db
        .insert(schema.venda)
        .values({ comercianteId: c, data: "2026-10-19", numeroCupom: "1", totalCentavos: 12345 });
      const d = (await request(servidor()).get("/painel/dados").set(como(c)).expect(200)).body as {
        comercio: string;
        ate: string;
        dia: { valor: { faturamento_centavos: number; gastos_centavos: unknown } };
        semana: { ausente?: boolean; codigo?: string };
        avisos: unknown[];
      };
      expect(d.comercio).toBe("E2E WhatsApp painel dados");
      expect(d.ate).toBe("2026-10-19");
      expect(d.dia.valor.faturamento_centavos).toBe(12345);
      expect(d.dia.valor.gastos_centavos).toMatchObject({ ausente: true });
      expect(d.semana).toMatchObject({ ausente: true, codigo: "periodo_sem_dados" });
      expect(Array.isArray(d.avisos)).toBe(true);
      expect((d as unknown as { limite_confianca: number }).limite_confianca).toBeGreaterThan(0);
    });
  });
});
