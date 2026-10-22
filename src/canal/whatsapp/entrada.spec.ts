import type { MensagemGravada } from "../caixa-mensagens";
import { entradaWhatsapp, lerEntrada } from "./entrada";
import { paraWhatsapp } from "./formato";
import { conferirSaida } from "./regras-meta";

describe("entrada no formato do webhook", () => {
  it("texto, botão de resposta, linha de lista e botão de modelo", () => {
    const texto = entradaWhatsapp.parse({ id: "wamid.dono123", type: "text", text: { body: " oi " } });
    expect(lerEntrada(texto)).toEqual({ texto: "oi", acao: null, tipo: "text", conteudo: null });

    const botao = entradaWhatsapp.parse({
      id: "wamid.dono124",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "avisos", title: "Ver avisos" } },
      context: { id: "8c1a0e44-6b8e-4b43-9d8a-3b8f2b1c0d11" },
    });
    expect(lerEntrada(botao)).toMatchObject({ texto: "Ver avisos", acao: "avisos", tipo: "interactive" });

    const linha = entradaWhatsapp.parse({
      id: "wamid.dono125",
      type: "interactive",
      interactive: {
        type: "list_reply",
        list_reply: { id: "resumo_mes", title: "Resumo do mês", description: "x" },
      },
    });
    expect(lerEntrada(linha)).toMatchObject({ texto: "Resumo do mês", acao: "resumo_mes" });

    const modelo = entradaWhatsapp.parse({
      id: "wamid.dono126",
      type: "button",
      button: { payload: "resumo_dia", text: "Resumo completo" },
    });
    expect(lerEntrada(modelo)).toEqual({
      texto: "Resumo completo",
      acao: "resumo_dia",
      tipo: "button",
      conteudo: { payload: "resumo_dia", text: "Resumo completo" },
    });
  });

  it.each([
    ["id curto", { id: "x", type: "text", text: { body: "oi" } }],
    ["id com barra", { id: "wamid/../../x", type: "text", text: { body: "oi" } }],
    [
      "campo a mais (comerciante_id não entra pelo corpo)",
      { id: "wamid.dono1", type: "text", text: { body: "oi" }, comerciante_id: "c" },
    ],
    ["texto acima de 4096", { id: "wamid.dono1", type: "text", text: { body: "a".repeat(4097) } }],
    ["foto pelo JSON (foto vai por /chat/notas)", { id: "wamid.dono1", type: "image", image: { id: "x" } }],
  ])("recusa %s", (_, corpo) => {
    expect(entradaWhatsapp.safeParse(corpo).success).toBe(false);
  });
});

describe("paraWhatsapp", () => {
  const base: MensagemGravada = {
    id: "3f0c2a52-6c1e-4b5b-9d0a-1c2b3d4e5f60",
    direcao: "recebida",
    texto: "oi",
    proativa: false,
    criadaEm: new Date("2026-10-22T10:00:00Z"),
    idExterno: "wamid.dono1",
    tipo: "text",
    conteudo: null,
    contextoId: null,
    status: "read",
  };

  it("a mensagem do dono usa o id do canal e leva o status (tiques)", () => {
    expect(paraWhatsapp(base)).toEqual({
      id: "wamid.dono1",
      direcao: "entrada",
      timestamp: Date.parse("2026-10-22T10:00:00Z"),
      type: "text",
      status: "read",
      text: { body: "oi" },
    });
  });

  it("a do agente usa o id do banco, sem status, com o objeto do tipo que o front desenha", () => {
    const interactive = {
      type: "button",
      body: { text: "x" },
      action: { buttons: [{ type: "reply", reply: { id: "menu", title: "Menu" } }] },
    };
    const m = paraWhatsapp({
      ...base,
      direcao: "enviada",
      tipo: "interactive",
      conteudo: interactive,
      status: "sent",
      contextoId: "wamid.dono1",
    });
    expect(m).toEqual({
      id: base.id,
      direcao: "saida",
      timestamp: base.criadaEm.getTime(),
      type: "interactive",
      context: { id: "wamid.dono1" },
      interactive,
    });
  });
});

describe("regras da Meta no backend", () => {
  it("lista com mais de 10 linhas e link fora de http são recusados", () => {
    const rows = Array.from({ length: 11 }, (_, i) => ({ id: `l${i}`, title: `Linha ${i}` }));
    expect(
      conferirSaida({
        type: "interactive",
        interactive: { type: "list", body: { text: "x" }, action: { button: "Ver", sections: [{ rows }] } },
      }).some((e) => e.includes("linhas")),
    ).toBe(true);
    expect(
      conferirSaida({
        type: "interactive",
        interactive: {
          type: "cta_url",
          body: { text: "x" },
          action: { name: "cta_url", parameters: { display_text: "Abrir", url: "javascript:alert(1)" } },
        },
      }),
    ).toContain("url precisa ser http, https ou caminho do próprio site");
  });
});
