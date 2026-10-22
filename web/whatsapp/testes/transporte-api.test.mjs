// Transporte do backend sem navegador nem servidor: `fetch` falso que imita as rotas do Nest.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { criarTransporteApi } from "../transporte-api.js";

const COMERCIANTE = "792c9aee-e71d-5dcd-8453-d512e1c0a9b3";
const json = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

let chamadas;
let rotas;
const fetchOriginal = globalThis.fetch;
const intervaloOriginal = globalThis.setInterval;
const timeoutOriginal = globalThis.setTimeout;

beforeEach(() => {
  chamadas = [];
  rotas = {};
  globalThis.fetch = async (url, opcoes = {}) => {
    chamadas.push({ url: String(url), opcoes });
    const rota = Object.keys(rotas).find((r) => String(url).startsWith(r));
    if (!rota) return json({ message: "Cannot GET" }, 404);
    return rotas[rota](opcoes);
  };
  // O polling e a consulta logo depois do envio ficam com o teste.
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = () => 0;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.setInterval = intervaloOriginal;
  globalThis.setTimeout = timeoutOriginal;
});

const sessao = () => json({ comerciante_id: COMERCIANTE, nome: "Mercadinho Vila Nova" });
const saida = (id, timestamp, extra = {}) => ({
  id,
  direcao: "saida",
  timestamp,
  type: "text",
  text: { body: "Oi" },
  ...extra,
});

describe("transporte do backend", () => {
  it("sem backend (servidor estático), falha para a tela cair na demonstração", async () => {
    await assert.rejects(criarTransporteApi({}), /Cannot GET/);
  });

  it("usa o comerciante da sessão em todo pedido, e o ?comerciante= quando informado", async () => {
    rotas["sessao"] = sessao;
    rotas["/chat/mensagens"] = () => json({ mensagens: [], digitando: false, janela_aberta: false });
    const t = await criarTransporteApi({ comerciante: COMERCIANTE });
    assert.equal(t.comercio, "Mercadinho Vila Nova");
    await t.historico();
    assert.equal(chamadas[0].url, `sessao?comerciante=${COMERCIANTE}`);
    assert.equal(chamadas[1].opcoes.headers["X-Comerciante-Id"], COMERCIANTE);
  });

  it("histórico: modelo fora da janela passa; texto fora da janela é marcado como recusado pela Meta", async () => {
    const agora = Date.now();
    rotas["sessao"] = sessao;
    rotas["/chat/mensagens"] = () =>
      json({
        mensagens: [
          saida("b", agora - 1000),
          {
            id: "a",
            direcao: "saida",
            timestamp: agora - 2000,
            type: "template",
            template: { name: "resumo_diario" },
          },
        ],
        digitando: false,
        janela_aberta: false,
      });
    const t = await criarTransporteApi({});
    const historico = await t.historico();
    assert.deepEqual(
      historico.map((m) => m.id),
      ["a", "b"],
    );
    assert.equal(historico[0].recusada, undefined);
    assert.equal(historico[1].recusada.length, 1);
  });

  it("envio de texto vai no formato do webhook; o status da mensagem do dono só avança por evento", async () => {
    const agora = Date.now();
    rotas["sessao"] = sessao;
    let corpoEnviado;
    rotas["/chat/mensagens"] = (opcoes) => {
      if (opcoes.method === "POST") {
        corpoEnviado = JSON.parse(opcoes.body);
        return json({
          mensagens: [
            {
              id: "wamid.dono1",
              direcao: "entrada",
              timestamp: agora,
              type: "text",
              status: "read",
              text: { body: "oi" },
            },
            saida("r1", agora + 10),
          ],
        });
      }
      return json({ mensagens: [], digitando: false, janela_aberta: false });
    };
    const t = await criarTransporteApi({});
    const eventos = [];
    t.aoEvento((e) => eventos.push(e));
    await t.historico();
    await t.enviar({
      id: "wamid.dono1",
      direcao: "entrada",
      timestamp: agora,
      status: "sent",
      type: "text",
      text: { body: "oi" },
      context: { id: "r0" },
    });
    assert.deepEqual(corpoEnviado, {
      id: "wamid.dono1",
      type: "text",
      text: { body: "oi" },
      context: { id: "r0" },
    });
    assert.deepEqual(
      eventos.map((e) => [e.tipo, e.id ?? e.mensagem?.id, e.status]),
      [
        ["status", "wamid.dono1", "read"],
        ["mensagem", "r1", undefined],
      ],
    );
  });

  it("foto vai por /chat/notas com o id da mensagem e a legenda", async () => {
    rotas["sessao"] = sessao;
    let formulario;
    rotas["/chat/notas"] = (opcoes) => {
      formulario = opcoes.body;
      return json({ documento_id: "d1", mensagens: [] });
    };
    const t = await criarTransporteApi({});
    const arquivo = new File([new Uint8Array([0xff, 0xd8, 0xff])], "nota.jpg", { type: "image/jpeg" });
    await t.enviar(
      {
        id: "wamid.dono2",
        type: "image",
        image: { link: "blob:x", caption: "nota do arroz" },
        status: "sent",
      },
      arquivo,
    );
    assert.equal(formulario.get("id"), "wamid.dono2");
    assert.equal(formulario.get("legenda"), "nota do arroz");
    assert.equal(formulario.get("arquivo").name, "nota.jpg");
  });

  it("resumo das 7h devolve o aviso do backend quando não sai (regra 9)", async () => {
    rotas["sessao"] = sessao;
    rotas["/chat/proativa"] = () =>
      json({ resultado: "ja_enviada_hoje", aviso: "O Omnia manda no máximo 1 mensagem proativa por dia." });
    rotas["/chat/mensagens"] = () => json({ mensagens: [], digitando: false, janela_aberta: false });
    const t = await criarTransporteApi({});
    assert.match(await t.simularProativa(), /no máximo 1 mensagem proativa/);
  });

  it("digitando segue o banco e é reenviado enquanto vale", async () => {
    rotas["sessao"] = sessao;
    let digitando = true;
    rotas["/chat/mensagens"] = () => json({ mensagens: [], digitando, janela_aberta: true });
    const t = await criarTransporteApi({});
    const eventos = [];
    t.aoEvento((e) => eventos.push(e));
    await t.historico();
    rotas["/chat/proativa"] = () => json({ resultado: "enviada", aviso: null });
    await t.simularProativa();
    digitando = false;
    await t.simularProativa();
    assert.deepEqual(
      eventos.filter((e) => e.tipo === "digitando").map((e) => e.ativo),
      [true, false],
    );
  });
});
