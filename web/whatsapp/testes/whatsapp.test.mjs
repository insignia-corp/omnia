// Testes do front simulado sem navegador: `npm run test:web` (node:test).
import assert from "node:assert/strict";
import process from "node:process";
import { describe, it, mock } from "node:test";
import { conferirAnexo, conferirSaida } from "../regras-meta.js";
import { criarTransporteDemo, porcento, reais, responder } from "../transporte-demo.js";

const AGORA = Date.parse("2026-10-22T10:00:00-03:00");
const config = { painelUrl: "/painel" };
const texto = (body) => ({ type: "text", text: { body } });
const corpo = (m) => m.text?.body ?? m.interactive?.body?.text ?? "";
const FALLBACK = "Ainda não sei responder";

describe("regras da Meta", () => {
  it("fora da janela de 24 h só aceita modelo", () => {
    assert.deepEqual(
      conferirSaida({ type: "template", template: { name: "resumo_diario" } }, null, AGORA),
      [],
    );
    assert.equal(conferirSaida(texto("oi"), null, AGORA).length, 1);
    assert.equal(conferirSaida(texto("oi"), AGORA - 25 * 3600 * 1000, AGORA).length, 1);
    assert.deepEqual(conferirSaida(texto("oi"), AGORA - 23 * 3600 * 1000, AGORA), []);
  });

  it("recusa texto acima de 4096 caracteres", () => {
    assert.equal(conferirSaida(texto("a".repeat(4097)), AGORA, AGORA).length, 1);
  });

  it("limita botões de resposta a 3 com título de até 20 caracteres", () => {
    const botoes = (n, titulo) => ({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "x" },
        action: {
          buttons: Array.from({ length: n }, (_, i) => ({
            type: "reply",
            reply: { id: `b${i}`, title: titulo },
          })),
        },
      },
    });
    assert.deepEqual(conferirSaida(botoes(3, "Ver avisos"), AGORA, AGORA), []);
    assert.ok(conferirSaida(botoes(4, "Ver avisos"), AGORA, AGORA).length > 0);
    assert.ok(conferirSaida(botoes(1, "Um título longo demais aqui"), AGORA, AGORA).length > 0);
  });

  it("limita a lista a 10 linhas no total", () => {
    const linhas = Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, title: `Linha ${i}` }));
    const lista = {
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: "x" },
        action: { button: "Ver", sections: [{ rows: linhas }] },
      },
    };
    assert.ok(conferirSaida(lista, AGORA, AGORA).some((e) => e.includes("linhas")));
  });

  it("devolve erro, sem lançar, para URL de botão inválida", () => {
    const link = (url) => ({
      type: "interactive",
      interactive: {
        type: "cta_url",
        body: { text: "x" },
        action: { name: "cta_url", parameters: { display_text: "Abrir", url } },
      },
    });
    assert.ok(conferirSaida(link("http://["), AGORA, AGORA).some((e) => e.includes("url inválida")));
  });

  it("exige id único em cada linha da lista", () => {
    const lista = (rows) => ({
      type: "interactive",
      interactive: { type: "list", body: { text: "x" }, action: { button: "Ver", sections: [{ rows }] } },
    });
    assert.ok(conferirSaida(lista([{ title: "Sem id" }]), AGORA, AGORA).some((e) => e.includes("row.id")));
    const repetidos = lista([
      { id: "a", title: "Um" },
      { id: "a", title: "Dois" },
    ]);
    assert.ok(conferirSaida(repetidos, AGORA, AGORA).some((e) => e.includes("repetido")));
  });

  it("aceita foto JPEG ou PNG até 5 MB e XML de NF-e", () => {
    assert.equal(conferirAnexo({ type: "image/jpeg", size: 1000, name: "n.jpg" }, "image"), null);
    assert.ok(conferirAnexo({ type: "image/gif", size: 1000, name: "n.gif" }, "image"));
    assert.ok(conferirAnexo({ type: "image/png", size: 5 * 1024 * 1024 + 1, name: "n.png" }, "image"));
    assert.equal(conferirAnexo({ type: "", size: 1000, name: "nfe.xml" }, "document"), null);
  });
});

describe("formatação de dinheiro e porcentagem", () => {
  it("formata centavos inteiros sem ponto flutuante", () => {
    assert.equal(reais(122151), "R$ 1.221,51");
    assert.equal(reais(5), "R$ 0,05");
    assert.equal(reais(3165305), "R$ 31.653,05");
    assert.equal(reais(-990), "-R$ 9,90");
  });

  it("formata pontos-base", () => {
    assert.equal(porcento(1205), "12,05%");
    assert.equal(porcento(2500), "25%");
    assert.equal(porcento(-3023), "-30,23%");
  });
});

describe("agente de demonstração", () => {
  const entradas = [
    texto("oi"),
    texto("resumo de ontem"),
    texto("como foi a semana?"),
    texto("resumo do mês"),
    texto("me dá um feedback"),
    texto("margem"),
    texto("abre o painel"),
    texto("qualquer coisa"),
    { type: "image", image: { link: "blob:x", mime_type: "image/jpeg" } },
    { type: "document", document: { filename: "nfe.xml" } },
  ];

  it("toda resposta respeita as regras da Meta com a janela aberta", () => {
    for (const e of entradas)
      for (const r of responder(e, config))
        assert.deepEqual(conferirSaida(r, AGORA, AGORA), [], JSON.stringify(r));
  });

  it("entende pedidos de resumo diário, semanal e mensal", () => {
    assert.match(corpo(responder(texto("resumo de ontem"), config)[0]), /Resumo de segunda, 19\/10/);
    assert.match(corpo(responder(texto("como foi a semana?"), config)[0]), /Resumo da semana/);
    assert.match(corpo(responder(texto("resumo do mês"), config)[0]), /Resumo do mês/);
    assert.equal(responder(texto("abre o painel"), config)[0].interactive.type, "cta_url");
  });

  it("todo botão e toda linha de lista que o agente oferece têm resposta própria", () => {
    const ids = new Set();
    for (const e of entradas)
      for (const r of responder(e, config)) {
        for (const b of r.interactive?.action?.buttons ?? []) ids.add(b.reply.id);
        for (const s of r.interactive?.action?.sections ?? []) for (const l of s.rows) ids.add(l.id);
      }
    for (const id of ["avisos", "resumo_dia", "cancelar"]) ids.add(id); // botões do modelo resumo_diario
    for (const id of ids) {
      const resposta = responder(
        { type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: id } } },
        config,
      );
      assert.ok(!corpo(resposta[0]).startsWith(FALLBACK), `sem resposta para ${id}`);
    }
  });

  it("não confirma preço-meta com um sim solto, sem proposta aberta (regra 7)", () => {
    const estado = {};
    assert.doesNotMatch(corpo(responder(texto("sim"), config, estado)[0]), /guardei/);
    responder(texto("sugere um preço"), config, estado);
    assert.match(corpo(responder(texto("sim"), config, estado)[0]), /guardei \*R\$ 37,20\*/);
    assert.doesNotMatch(corpo(responder(texto("sim"), config, estado)[0]), /guardei/);
  });

  it("diz que não sabe o lucro nem faz previsão, sem números", () => {
    for (const pergunta of ["Qual foi meu lucro do mês?", "Qual vai ser meu faturamento do mês que vem?"]) {
      const [r] = responder(texto(pergunta), config, {});
      assert.doesNotMatch(corpo(r), /R\$|\d/, pergunta);
    }
  });

  it("corrige item da nota depois de pedir a correção", () => {
    const estado = {};
    responder(
      { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "nota_corrigir" } } },
      config,
      estado,
    );
    const r = corpo(responder(texto("sal 6 por 1,30"), config, estado)[0]);
    assert.match(r, /Sal refinado 1kg\*: 6 un\. x R\$ 1,30 = R\$ 7,80/);
    assert.match(r, /R\$ 474,00/);
    assert.ok(!estado.aguardandoCorrecao);
  });
});

describe("transporte de demonstração", () => {
  const doDono = (body) => ({
    id: "wamid.x",
    direcao: "entrada",
    timestamp: Date.now(),
    type: "text",
    text: { body },
  });

  it("limpar a conversa não libera uma segunda proativa no mesmo dia (regra 9)", async () => {
    const t = criarTransporteDemo(config);
    assert.equal(await t.simularProativa(), null);
    await t.reiniciar();
    assert.match(await t.simularProativa(), /no máximo 1/);
  });

  it("limpar a conversa cancela respostas ainda na fila", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const t = criarTransporteDemo(config);
      const eventos = [];
      t.aoEvento((e) => eventos.push(e));
      await t.enviar(doDono("oi"));
      await t.reiniciar();
      for (let i = 0; i < 40; i++) {
        mock.timers.tick(250);
        await new Promise((r) => process.nextTick(r));
      }
      assert.deepEqual(
        eventos.filter((e) => e.tipo !== "digitando"),
        [],
      );
    } finally {
      mock.timers.reset();
    }
  });
});
