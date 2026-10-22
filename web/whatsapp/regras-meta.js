/**
 * Regras da WhatsApp Cloud API (Meta) que o front confere antes de mostrar uma mensagem da empresa.
 * Fonte: documentação oficial de mensagens da Cloud API (tipos text, image, document, interactive e template).
 * O backend real recebe os mesmos erros da Meta; aqui eles viram aviso na tela para a integração pegar cedo.
 */

export const LIMITES = {
  texto: 4096,
  legenda: 1024,
  corpoInterativo: 1024,
  cabecalhoTexto: 60,
  rodape: 60,
  botoesResposta: 3,
  tituloBotao: 20,
  idBotao: 256,
  textoBotaoLista: 20,
  secoesLista: 10,
  linhasLista: 10,
  tituloLinha: 24,
  descricaoLinha: 72,
  tituloSecao: 24,
  textoBotaoLink: 20,
  imagemBytes: 5 * 1024 * 1024,
  documentoBytes: 100 * 1024 * 1024,
  janelaAtendimentoMs: 24 * 60 * 60 * 1000,
};

export const TIPOS_IMAGEM = ["image/jpeg", "image/png"];
/** Só o XML da NF-e: o backend lê foto (JPEG, PNG) e XML; PDF seria recusado com 415. */
export const TIPOS_DOCUMENTO = ["application/xml", "text/xml"];

const tamanho = (rotulo, texto, max) =>
  typeof texto === "string" && texto.length > max ? [`${rotulo} passa de ${max} caracteres`] : [];

const obrigatorio = (rotulo, texto) =>
  typeof texto === "string" && texto.trim() ? [] : [`${rotulo} é obrigatório`];

function conferirInterativo(it) {
  const erros = [
    ...obrigatorio("body.text", it.body?.text),
    ...tamanho("body.text", it.body?.text, LIMITES.corpoInterativo),
    ...tamanho("footer.text", it.footer?.text, LIMITES.rodape),
  ];
  if (it.header?.type === "text")
    erros.push(...tamanho("header.text", it.header.text, LIMITES.cabecalhoTexto));

  if (it.type === "button") {
    const botoes = it.action?.buttons ?? [];
    if (botoes.length < 1 || botoes.length > LIMITES.botoesResposta)
      erros.push(`botões de resposta: de 1 a ${LIMITES.botoesResposta}`);
    const ids = new Set();
    for (const b of botoes) {
      erros.push(...obrigatorio("reply.title", b.reply?.title));
      erros.push(...tamanho("reply.title", b.reply?.title, LIMITES.tituloBotao));
      erros.push(...tamanho("reply.id", b.reply?.id, LIMITES.idBotao));
      if (ids.has(b.reply?.id)) erros.push(`reply.id repetido: ${b.reply?.id}`);
      ids.add(b.reply?.id);
    }
  } else if (it.type === "list") {
    const secoes = it.action?.sections ?? [];
    erros.push(...obrigatorio("action.button", it.action?.button));
    erros.push(...tamanho("action.button", it.action?.button, LIMITES.textoBotaoLista));
    if (secoes.length < 1 || secoes.length > LIMITES.secoesLista)
      erros.push(`seções da lista: de 1 a ${LIMITES.secoesLista}`);
    const linhas = secoes.flatMap((s) => s.rows ?? []);
    if (linhas.length < 1 || linhas.length > LIMITES.linhasLista)
      erros.push(`linhas da lista: de 1 a ${LIMITES.linhasLista} no total`);
    for (const s of secoes) {
      if (secoes.length > 1) erros.push(...obrigatorio("section.title", s.title));
      erros.push(...tamanho("section.title", s.title, LIMITES.tituloSecao));
    }
    for (const l of linhas) {
      erros.push(...obrigatorio("row.title", l.title));
      erros.push(...tamanho("row.title", l.title, LIMITES.tituloLinha));
      erros.push(...tamanho("row.description", l.description, LIMITES.descricaoLinha));
    }
  } else if (it.type === "cta_url") {
    const p = it.action?.parameters ?? {};
    erros.push(...obrigatorio("display_text", p.display_text));
    erros.push(...tamanho("display_text", p.display_text, LIMITES.textoBotaoLink));
    const base = globalThis.location?.href ?? "http://localhost/";
    if (!/^https?:\/\//.test(new URL(p.url ?? "", base).href)) erros.push("url precisa ser http ou https");
  } else {
    erros.push(`interactive.type não suportado: ${it.type}`);
  }
  return erros;
}

/**
 * Confere uma mensagem que a empresa (o agente) envia ao dono.
 * @param {import("./tipos.js").Mensagem} m
 * @param {number | null} ultimaDoDonoMs instante da última mensagem do dono, ou null se ele nunca escreveu
 * @param {number} agoraMs
 * @returns {string[]} lista vazia quando a Meta aceitaria
 */
export function conferirSaida(m, ultimaDoDonoMs, agoraMs) {
  const erros = [];
  const janelaAberta = ultimaDoDonoMs !== null && agoraMs - ultimaDoDonoMs <= LIMITES.janelaAtendimentoMs;
  if (m.type !== "template" && !janelaAberta)
    erros.push("fora da janela de 24 h: a Meta só aceita mensagem de modelo (template)");

  switch (m.type) {
    case "text":
      erros.push(
        ...obrigatorio("text.body", m.text?.body),
        ...tamanho("text.body", m.text?.body, LIMITES.texto),
      );
      break;
    case "image":
      erros.push(...tamanho("image.caption", m.image?.caption, LIMITES.legenda));
      break;
    case "document":
      erros.push(...tamanho("document.caption", m.document?.caption, LIMITES.legenda));
      break;
    case "interactive":
      erros.push(...conferirInterativo(m.interactive ?? {}));
      break;
    case "template":
      erros.push(...obrigatorio("template.name", m.template?.name));
      break;
    default:
      erros.push(`type não suportado: ${m.type}`);
  }
  return erros;
}

/**
 * Confere um arquivo que o dono anexa.
 * @param {File} arquivo
 * @param {"image" | "document"} tipo
 * @returns {string | null} motivo da recusa, ou null
 */
export function conferirAnexo(arquivo, tipo) {
  if (tipo === "image") {
    if (!TIPOS_IMAGEM.includes(arquivo.type)) return "Envie a foto em JPEG ou PNG.";
    if (arquivo.size > LIMITES.imagemBytes) return "A foto passa de 5 MB, o limite do WhatsApp para imagens.";
    return null;
  }
  const xml = /\.xml$/i.test(arquivo.name);
  if (!xml && !TIPOS_DOCUMENTO.includes(arquivo.type))
    return "Envie o XML da NF-e. Nota em papel vai como foto.";
  if (arquivo.size > LIMITES.documentoBytes) return "O documento passa de 100 MB.";
  return null;
}
