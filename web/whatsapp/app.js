/**
 * Tela da conversa: liga composição, anexos, listas e menu ao transporte escolhido em `config.js`.
 * O estado da tela (mensagens já desenhadas) é só visual; quem guarda a conversa é o transporte
 * (na integração, o backend e o PostgreSQL).
 */
import { CONFIG, guardar } from "./config.js";
import { icone } from "./icones.js";
import { conferirAnexo } from "./regras-meta.js";
import { avisosIniciais, linhaMensagem, meta, separadorDia } from "./render.js";
import { criarTransporteApi } from "./transporte-api.js";
import { criarTransporteDemo } from "./transporte-demo.js";

const $ = (id) => document.getElementById(id);
const raiz = document.documentElement;
const conversa = $("conversa");
const campo = $("texto");

// Ícones fixos da tela.
for (const [id, nome] of [
  ["icone-video", "video"],
  ["icone-ligar", "ligar"],
  ["icone-buscar", "buscar"],
  ["abrir-menu", "menu"],
  ["abrir-anexos", "mais"],
  ["abrir-emojis", "emoji"],
  ["fechar-previa", "fechar"],
  ["enviar-anexo", "enviar"],
  ["fechar-lista", "fechar"],
  ["enviar-lista", "enviar"],
  ["fechar-ampliada", "fechar"],
  ["ic-doc", "documento"],
  ["ic-foto", "foto"],
]) {
  $(id).append(icone(nome));
}
$("descer").prepend(icone("descer"));

// Aviso rápido (toast).
let temporizadorAviso;
function avisar(texto) {
  const a = $("aviso");
  a.textContent = texto;
  a.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => (a.hidden = true), 3500);
}

// Escala da letra e tema.
function aplicarEscala(valor) {
  CONFIG.escala = Math.round(Math.min(Math.max(valor, 0.9), 2) * 10) / 10;
  raiz.style.setProperty("--escala", String(CONFIG.escala));
  guardar("escala", CONFIG.escala);
}

function aplicarTema(tema) {
  CONFIG.tema = tema;
  raiz.dataset.tema = tema;
  document.querySelector('[data-acao="tema"]').textContent = tema === "claro" ? "Tema escuro" : "Tema claro";
  guardar("tema", tema);
}

aplicarEscala(CONFIG.escala);
aplicarTema(CONFIG.tema);

// Conversa.
/** @type {import("./tipos.js").Mensagem[]} */
const mensagens = [];
const porId = new Map();
let naoLidas = 0;

const pertoDoFim = () => conversa.scrollHeight - conversa.scrollTop - conversa.clientHeight < 140;

function atualizarDescer() {
  $("descer").hidden = pertoDoFim();
  $("nao-lidas").hidden = naoLidas === 0;
  $("nao-lidas").textContent = String(naoLidas);
}

function irAoFim(suave = true) {
  conversa.scrollTo({ top: conversa.scrollHeight, behavior: suave ? "smooth" : "auto" });
  naoLidas = 0;
  atualizarDescer();
}

conversa.addEventListener("scroll", () => {
  if (pertoDoFim()) naoLidas = 0;
  atualizarDescer();
});
$("descer").addEventListener("click", () => irAoFim());

const mesmoDia = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

function adicionar(m, animar = true) {
  const anterior = mensagens.at(-1);
  const novoDia = !anterior || !mesmoDia(anterior.timestamp, m.timestamp);
  const estavaNoFim = pertoDoFim();
  if (novoDia) conversa.append(separadorDia(m.timestamp));
  const comCauda =
    novoDia ||
    anterior.direcao !== m.direcao ||
    Boolean(anterior.recusada?.length) ||
    Boolean(m.recusada?.length);
  mensagens.push(m);
  porId.set(m.id, m);

  const linha = linhaMensagem(m, { comCauda, porId, acoes });
  if (animar) linha.classList.add("nova");
  conversa.append(linha);

  const seguir = m.direcao === "entrada" || estavaNoFim;
  for (const img of linha.querySelectorAll("img"))
    img.addEventListener("load", () => seguir && irAoFim(false));
  if (seguir) irAoFim();
  else {
    naoLidas += 1;
    atualizarDescer();
  }
}

// Status só avança (o "entregue" pode chegar antes da confirmação do envio); "failed" vale sempre.
const ORDEM_STATUS = { sent: 1, delivered: 2, read: 3 };

function atualizarStatus(id, status) {
  const m = porId.get(id);
  if (!m) return;
  if (status !== "failed" && (ORDEM_STATUS[m.status] ?? 0) >= ORDEM_STATUS[status]) return;
  m.status = status;
  conversa.querySelector(`[data-id="${CSS.escape(id)}"] .meta`)?.replaceWith(meta(m));
}

function digitando(ativo) {
  const s = $("situacao");
  s.textContent = ativo ? "digitando…" : "Conta comercial";
  s.classList.toggle("digitando", ativo);
}

function limparTela() {
  mensagens.length = 0;
  porId.clear();
  conversa.replaceChildren(...avisosIniciais());
  naoLidas = 0;
  atualizarDescer();
}

// Transporte: o backend quando a página vem do Nest, a demonstração com `?modo=demo` ou sem backend.
async function criarTransporte() {
  if (CONFIG.modo === "demo") return criarTransporteDemo(CONFIG);
  try {
    return await criarTransporteApi(CONFIG);
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    avisar(`Sem o backend (${motivo}); usando a demonstração.`);
    console.warn("[omnia] modo api indisponível:", erro);
    return criarTransporteDemo(CONFIG);
  }
}

const transporte = await criarTransporte();
transporte.aoEvento((e) => {
  if (e.tipo === "mensagem") {
    digitando(false);
    adicionar(e.mensagem);
  } else if (e.tipo === "status") {
    atualizarStatus(e.id, e.status);
  } else if (e.tipo === "digitando") {
    digitando(e.ativo);
  }
});

const novoId = () => `wamid.dono${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Monta a mensagem do dono no formato do webhook, desenha com relógio e entrega ao transporte. */
async function enviarDoDono(parcial, arquivo) {
  const m = { id: novoId(), direcao: "entrada", timestamp: Date.now(), ...parcial };
  adicionar(m);
  try {
    await transporte.enviar({ ...m, status: "sent" }, arquivo);
    atualizarStatus(m.id, "sent");
  } catch (erro) {
    atualizarStatus(m.id, "failed");
    avisar(erro instanceof Error ? erro.message : "Não foi possível enviar.");
  }
}

// Ações disparadas de dentro das bolhas.
/** @type {import("./render.js").Acoes} */
const acoes = {
  responderBotao(origem, resposta) {
    const context = { id: origem.id };
    if (origem.type === "template")
      void enviarDoDono({ type: "button", button: { payload: resposta.id, text: resposta.title }, context });
    else
      void enviarDoDono({
        type: "interactive",
        interactive: { type: "button_reply", button_reply: { id: resposta.id, title: resposta.title } },
        context,
      });
  },
  abrirLista(origem) {
    abrirLista(origem);
  },
  abrirLink(url) {
    window.open(new URL(url, location.href).href, "_blank", "noopener");
  },
  ampliarImagem(src, legenda) {
    $("img-ampliada").src = src;
    $("img-ampliada").alt = legenda || "Foto";
    $("legenda-ampliada").textContent = legenda;
    $("ampliada").hidden = false;
  },
};

// Composição de texto.
function ajustarCampo() {
  campo.style.height = "auto";
  campo.style.height = `${campo.scrollHeight}px`;
  const temTexto = campo.value.trim().length > 0;
  const botao = $("enviar");
  botao.classList.toggle("pronto", temTexto);
  botao.setAttribute("aria-label", temTexto ? "Enviar" : "Mensagem de voz");
  botao.replaceChildren(icone(temTexto ? "enviar" : "microfone"));
}

function enviarTexto() {
  const body = campo.value.trim();
  if (!body) return;
  campo.value = "";
  ajustarCampo();
  void enviarDoDono({ type: "text", text: { body } });
}

campo.addEventListener("input", ajustarCampo);
campo.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    enviarTexto();
  }
});
$("enviar").addEventListener("click", () => {
  if (campo.value.trim()) enviarTexto();
  else avisar("Mensagens de voz ainda não fazem parte da demonstração.");
});
ajustarCampo();

// Menus suspensos (três pontos, anexos, emojis): um aberto por vez.
const SUSPENSOS = [
  ["abrir-menu", "menu"],
  ["abrir-anexos", "anexos"],
  ["abrir-emojis", "emojis"],
];

function fecharSuspensos(exceto) {
  for (const [botao, painel] of SUSPENSOS) {
    if (painel === exceto) continue;
    $(painel).hidden = true;
    $(botao).setAttribute("aria-expanded", "false");
  }
}

for (const [botao, painel] of SUSPENSOS) {
  $(botao).addEventListener("click", (e) => {
    e.stopPropagation();
    const abrir = $(painel).hidden;
    fecharSuspensos(painel);
    $(painel).hidden = !abrir;
    $(botao).setAttribute("aria-expanded", String(abrir));
  });
}
document.addEventListener("click", (e) => {
  if (!(e.target instanceof Element) || !e.target.closest(".menu-suspenso, .anexos, .emojis"))
    fecharSuspensos();
});

for (const emoji of "👍 🙏 😀 😂 😊 😍 🤔 😅 👏 💪 🎉 ✅ ❌ ⚠️ 💰 📈 📉 🧾 🛒 📦 ☕ 🍞 🥛 🍺".split(" ")) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = emoji;
  b.addEventListener("click", () => {
    const { selectionStart: i, selectionEnd: f, value } = campo;
    campo.value = value.slice(0, i) + emoji + value.slice(f);
    campo.selectionStart = campo.selectionEnd = i + emoji.length;
    campo.focus();
    ajustarCampo();
  });
  $("emojis").append(b);
}

$("menu").addEventListener("click", async (e) => {
  const acao =
    e.target instanceof Element ? e.target.closest("[data-acao]")?.getAttribute("data-acao") : null;
  fecharSuspensos();
  if (acao === "proativa") {
    const recusa = await transporte.simularProativa?.();
    if (recusa) avisar(recusa);
  } else if (acao === "aumentar") aplicarEscala(CONFIG.escala + 0.1);
  else if (acao === "diminuir") aplicarEscala(CONFIG.escala - 0.1);
  else if (acao === "tema") aplicarTema(CONFIG.tema === "claro" ? "escuro" : "claro");
  else if (acao === "limpar") {
    await transporte.reiniciar?.();
    limparTela();
  }
});

// Anexos: escolha, conferência pelas regras da Meta e prévia com legenda.
let anexo = null;

$("anexos").addEventListener("click", (e) => {
  const tipo =
    e.target instanceof Element ? e.target.closest("[data-anexo]")?.getAttribute("data-anexo") : null;
  fecharSuspensos();
  if (tipo === "image") $("arquivo-foto").click();
  if (tipo === "document") $("arquivo-doc").click();
});

function abrirPrevia(arquivo, tipo) {
  const recusa = conferirAnexo(arquivo, tipo);
  if (recusa) {
    avisar(recusa);
    return;
  }
  const url = URL.createObjectURL(arquivo);
  anexo = { arquivo, tipo, url };
  $("previa-nome").textContent = arquivo.name;
  const conteudo = $("previa-conteudo");
  if (tipo === "image") {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Prévia da foto";
    conteudo.replaceChildren(img);
  } else {
    const doc = document.createElement("div");
    doc.className = "documento";
    const nome = document.createElement("span");
    nome.textContent = arquivo.name;
    doc.append(icone("documento"), nome);
    conteudo.replaceChildren(doc);
  }
  $("legenda").value = "";
  $("previa").hidden = false;
  $("legenda").focus();
}

function fecharPrevia(revogar = true) {
  if (revogar && anexo) URL.revokeObjectURL(anexo.url);
  anexo = null;
  $("previa").hidden = true;
  campo.focus();
}

for (const [id, tipo] of [
  ["arquivo-foto", "image"],
  ["arquivo-doc", "document"],
]) {
  $(id).addEventListener("change", () => {
    const arquivo = $(id).files?.[0];
    $(id).value = "";
    if (arquivo) abrirPrevia(arquivo, tipo);
  });
}

function enviarAnexo() {
  if (!anexo) return;
  const { arquivo, tipo, url } = anexo;
  const caption = $("legenda").value.trim() || undefined;
  const parcial =
    tipo === "image"
      ? { type: "image", image: { link: url, mime_type: arquivo.type, caption } }
      : {
          type: "document",
          document: {
            link: url,
            filename: arquivo.name,
            mime_type: arquivo.type,
            tamanho: arquivo.size,
            caption,
          },
        };
  fecharPrevia(false);
  void enviarDoDono(parcial, arquivo);
}

$("enviar-anexo").addEventListener("click", enviarAnexo);
$("legenda").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  // Sem isto o Enter cai no campo de texto, que recebe o foco ao fechar a prévia.
  e.preventDefault();
  enviarAnexo();
});
$("fechar-previa").addEventListener("click", () => fecharPrevia());

// Arrastar a foto para a conversa também abre a prévia, como no WhatsApp Web.
conversa.addEventListener("dragover", (e) => e.preventDefault());
conversa.addEventListener("drop", (e) => {
  e.preventDefault();
  const arquivo = e.dataTransfer?.files?.[0];
  if (arquivo) abrirPrevia(arquivo, arquivo.type.startsWith("image/") ? "image" : "document");
});

// Lista (interactive list): escolhe uma linha e envia como list_reply citando a mensagem.
let listaAberta = null;

function abrirLista(origem) {
  const it = origem.interactive;
  listaAberta = origem;
  $("titulo-lista").textContent = it.action.button;
  const corpo = $("corpo-lista");
  corpo.replaceChildren();
  for (const secao of it.action.sections) {
    if (secao.title) {
      const t = document.createElement("div");
      t.className = "secao-lista";
      t.textContent = secao.title;
      corpo.append(t);
    }
    for (const linha of secao.rows) {
      const rotulo = document.createElement("label");
      rotulo.className = "opcao-lista";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "opcao-lista";
      radio.value = linha.id;
      radio.addEventListener("change", () => ($("enviar-lista").disabled = false));
      const textoOpcao = document.createElement("span");
      textoOpcao.className = "opcao-texto";
      const titulo = document.createElement("span");
      titulo.textContent = linha.title;
      textoOpcao.append(titulo);
      if (linha.description) {
        const d = document.createElement("small");
        d.textContent = linha.description;
        textoOpcao.append(d);
      }
      rotulo.append(radio, textoOpcao);
      corpo.append(rotulo);
    }
  }
  $("enviar-lista").disabled = true;
  $("fundo-lista").hidden = false;
}

function fecharLista() {
  listaAberta = null;
  $("fundo-lista").hidden = true;
}

$("fechar-lista").addEventListener("click", fecharLista);
$("fundo-lista").addEventListener("click", (e) => e.target === $("fundo-lista") && fecharLista());
$("enviar-lista").addEventListener("click", () => {
  const escolhido = $("corpo-lista").querySelector("input:checked");
  if (!listaAberta || !escolhido) return;
  const linha = listaAberta.interactive.action.sections
    .flatMap((s) => s.rows)
    .find((r) => r.id === escolhido.value);
  const origem = listaAberta;
  fecharLista();
  void enviarDoDono({
    type: "interactive",
    interactive: {
      type: "list_reply",
      list_reply: { id: linha.id, title: linha.title, description: linha.description },
    },
    context: { id: origem.id },
  });
});

// Foto ampliada.
$("fechar-ampliada").addEventListener("click", () => ($("ampliada").hidden = true));
$("ampliada").addEventListener("click", (e) => e.target === $("ampliada") && ($("ampliada").hidden = true));

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  fecharSuspensos();
  if (!$("ampliada").hidden) $("ampliada").hidden = true;
  else if (!$("fundo-lista").hidden) fecharLista();
  else if (!$("previa").hidden) fecharPrevia();
});

// Início.
limparTela();
for (const m of await transporte.historico()) adicionar(m, false);
irAoFim(false);
campo.focus();
