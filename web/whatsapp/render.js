/**
 * Desenha a conversa no estilo do WhatsApp: bolhas com cauda, horário, tiques, citação,
 * separador de dia e os tipos de mensagem da Cloud API. Só cria nós DOM; quem decide o que
 * acontece num clique é `acoes`, passado pela app.
 */
import { formatar, textoPlano } from "./formato.js";
import { icone } from "./icones.js";
import { preencherModelo } from "./modelos.js";

/**
 * @typedef {import("./tipos.js").Mensagem} Mensagem
 * @typedef {object} Acoes
 * @property {(origem: Mensagem, resposta: { id: string, title: string }) => void} responderBotao
 * @property {(origem: Mensagem) => void} abrirLista
 * @property {(url: string) => void} abrirLink
 * @property {(src: string, legenda: string) => void} ampliarImagem
 */

const el = (tag, classe, ...filhos) => {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  e.append(...filhos.filter((f) => f !== null && f !== undefined && f !== false));
  return e;
};

export const hora = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const inicioDoDia = (ts) => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function rotuloDia(ts, agora = Date.now()) {
  const dias = Math.round((inicioDoDia(agora) - inicioDoDia(ts)) / 86_400_000);
  if (dias === 0) return "Hoje";
  if (dias === 1) return "Ontem";
  if (dias < 7) {
    const s = new Date(ts).toLocaleDateString("pt-BR", { weekday: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return new Date(ts).toLocaleDateString("pt-BR");
}

const tamanhoArquivo = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
    : `${Math.ceil(bytes / 1024)} kB`;

/** Texto de uma linha que representa a mensagem (citações e leitores de tela). */
export function resumo(m) {
  switch (m.type) {
    case "text":
      return textoPlano(m.text?.body ?? "");
    case "image":
      return m.image?.caption ? textoPlano(m.image.caption) : "Foto";
    case "document":
      return m.document?.filename ?? "Documento";
    case "interactive": {
      const it = m.interactive ?? {};
      if (it.type === "button_reply") return it.button_reply?.title ?? "";
      if (it.type === "list_reply") return it.list_reply?.title ?? "";
      return textoPlano(it.body?.text ?? "");
    }
    case "button":
      return m.button?.text ?? "";
    case "template":
      return textoPlano(preencherModelo(m.template ?? { name: "" })?.corpo ?? "Mensagem");
    default:
      return "";
  }
}

function tiques(status) {
  if (status === "read") return icone("tiqueDuplo", "tique lido");
  if (status === "delivered") return icone("tiqueDuplo", "tique");
  if (status === "sent") return icone("tique", "tique");
  if (status === "failed") return icone("erro", "tique falhou");
  return icone("relogio", "tique");
}

const ROTULO_STATUS = { sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Não enviada" };

export function meta(m) {
  const t = el("span", "meta", el("time", "", hora(m.timestamp)));
  t.querySelector("time").dateTime = new Date(m.timestamp).toISOString();
  if (m.direcao === "entrada") {
    const s = el("span", "status", tiques(m.status));
    s.title = ROTULO_STATUS[m.status] ?? "Enviando";
    s.setAttribute("aria-label", s.title);
    t.append(s);
  }
  return t;
}

/** Texto com espaço reservado no fim para o horário caber na última linha, como no app. */
const texto = (corpo, classe = "texto") => el("div", classe, ...formatar(corpo), el("span", "reserva-meta"));

function citacao(m, porId) {
  const original = m.context?.id ? porId.get(m.context.id) : null;
  if (!original) return null;
  const c = el(
    "button",
    `citacao ${original.direcao === "entrada" ? "de-voce" : "do-agente"}`,
    el("span", "autor", original.direcao === "entrada" ? "Você" : "Omnia"),
    el("span", "trecho", resumo(original)),
  );
  c.type = "button";
  c.addEventListener("click", () => {
    const alvo = document.querySelector(`[data-id="${CSS.escape(original.id)}"]`);
    alvo?.scrollIntoView({ behavior: "smooth", block: "center" });
    alvo?.classList.remove("destaque");
    void alvo?.offsetWidth;
    alvo?.classList.add("destaque");
  });
  return c;
}

function botao(rotulo, nomeIcone, aoClicar) {
  const b = el("button", "botao-acao", icone(nomeIcone), el("span", "", rotulo));
  b.type = "button";
  b.addEventListener("click", aoClicar);
  return b;
}

function conteudoInterativo(m, acoes) {
  const it = m.interactive ?? {};
  const partes = [];
  if (it.header?.type === "text") partes.push(el("div", "cabecalho", it.header.text));
  partes.push(texto(it.body?.text ?? ""));
  if (it.footer?.text) partes.push(el("div", "rodape", it.footer.text));

  let botoes = [];
  if (it.type === "button") {
    botoes = (it.action?.buttons ?? []).map((b) =>
      botao(b.reply.title, "responder", () => acoes.responderBotao(m, b.reply)),
    );
  } else if (it.type === "list") {
    botoes = [botao(it.action?.button ?? "Ver opções", "lista", () => acoes.abrirLista(m))];
  } else if (it.type === "cta_url") {
    const p = it.action?.parameters ?? {};
    botoes = [botao(p.display_text, "link", () => acoes.abrirLink(p.url))];
  }
  return { partes, botoes };
}

function conteudoModelo(m, acoes) {
  const modelo = preencherModelo(m.template ?? { name: "" });
  if (!modelo) return { partes: [texto(`Modelo desconhecido: ${m.template?.name}`)], botoes: [] };
  const partes = [];
  if (modelo.cabecalho) partes.push(el("div", "cabecalho", modelo.cabecalho));
  partes.push(texto(modelo.corpo));
  if (modelo.rodape) partes.push(el("div", "rodape", modelo.rodape));
  const botoes = modelo.botoes.map((b) => botao(b.title, "responder", () => acoes.responderBotao(m, b)));
  return { partes, botoes };
}

function conteudoImagem(m, acoes) {
  const src = m.image?.link ?? "";
  const img = el("img", "foto");
  img.src = src;
  img.alt = m.image?.caption ? textoPlano(m.image.caption) : "Foto enviada";
  img.loading = "lazy";
  const moldura = el("button", "moldura-foto", img);
  moldura.type = "button";
  moldura.addEventListener("click", () => acoes.ampliarImagem(src, m.image?.caption ?? ""));
  const partes = [moldura];
  if (m.image?.caption) partes.push(texto(m.image.caption, "texto legenda"));
  return { partes, botoes: [], soMidia: !m.image?.caption };
}

function conteudoDocumento(m) {
  const d = m.document ?? { filename: "documento" };
  const extensao = (d.filename.split(".").pop() ?? "").toUpperCase();
  const detalhe = [extensao, d.tamanho ? tamanhoArquivo(d.tamanho) : null].filter(Boolean).join(" · ");
  const cartao = el(
    "div",
    "documento",
    el("span", "doc-icone", icone("documento")),
    el("span", "doc-texto", el("span", "doc-nome", d.filename), el("span", "doc-detalhe", detalhe)),
  );
  const partes = [cartao];
  if (d.caption) partes.push(texto(d.caption, "texto legenda"));
  else partes.push(el("span", "reserva-meta bloco"));
  return { partes, botoes: [] };
}

function conteudoResposta(m) {
  const it = m.interactive ?? {};
  const r = it.button_reply ?? it.list_reply ?? { title: "" };
  const descricao = it.list_reply?.description;
  const partes = descricao
    ? [el("div", "titulo-resposta", r.title), texto(descricao, "texto descricao-resposta")]
    : [texto(r.title)];
  return { partes, botoes: [] };
}

/**
 * Cria a linha (com bolha) de uma mensagem.
 * @param {Mensagem} m
 * @param {{ comCauda: boolean, porId: Map<string, Mensagem>, acoes: Acoes }} opcoes
 */
export function linhaMensagem(m, { comCauda, porId, acoes }) {
  const lado = m.direcao === "entrada" ? "do-dono" : "do-agente";
  const linha = el("div", `linha ${lado}${comCauda ? " cauda" : ""}`);
  linha.dataset.id = m.id;

  if (m.recusada?.length) {
    linha.className = "linha aviso-sistema";
    linha.append(
      el(
        "div",
        "chip recusa",
        icone("erro"),
        el("span", "", `A Meta recusaria esta mensagem do agente: ${m.recusada.join("; ")}.`),
      ),
    );
    return linha;
  }

  let c;
  if (m.type === "text") c = { partes: [texto(m.text?.body ?? "")], botoes: [] };
  else if (m.type === "image") c = conteudoImagem(m, acoes);
  else if (m.type === "document") c = conteudoDocumento(m);
  else if (m.type === "template") c = conteudoModelo(m, acoes);
  else if (m.type === "interactive" && m.direcao === "saida") c = conteudoInterativo(m, acoes);
  else if (m.type === "interactive") c = conteudoResposta(m);
  else if (m.type === "button") c = { partes: [texto(m.button?.text ?? "")], botoes: [] };
  else c = { partes: [texto("Mensagem não suportada")], botoes: [] };

  const conteudo = el("div", "conteudo", citacao(m, porId), ...c.partes, meta(m));
  const bolha = el("div", `bolha${c.soMidia ? " so-midia" : ""}`, conteudo);
  if (c.botoes.length) {
    bolha.classList.add("com-botoes");
    bolha.append(el("div", "botoes", ...c.botoes));
  }
  linha.append(bolha);
  return linha;
}

export const separadorDia = (ts) => el("div", "linha aviso-sistema dia", el("span", "chip", rotuloDia(ts)));

export function avisosIniciais() {
  return [
    el(
      "div",
      "linha aviso-sistema",
      el(
        "div",
        "chip cripto",
        icone("cadeado"),
        el(
          "span",
          "",
          "Esta empresa usa um serviço seguro da Meta para gerenciar esta conversa. As mensagens são protegidas.",
        ),
      ),
    ),
    el(
      "div",
      "linha aviso-sistema",
      el(
        "div",
        "chip",
        el("span", "", "Esta conversa é com uma conta comercial: Omnia, gestor do seu mercadinho."),
      ),
    ),
  ];
}
