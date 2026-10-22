/**
 * Regras da WhatsApp Cloud API (Meta) conferidas no backend antes de gravar uma mensagem da empresa.
 * O front simulado confere as mesmas (`web/whatsapp/regras-meta.js`, dono da tabela de limites no
 * README de lá); aqui elas valem para o que o canal real (#61 a #63) vai mandar à Meta.
 */
import type { SaidaWhatsapp } from "./formato";

export const LIMITES_META = {
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
  janelaAtendimentoHoras: 24,
} as const;

const tamanho = (rotulo: string, texto: string | undefined, max: number): string[] =>
  typeof texto === "string" && texto.length > max ? [`${rotulo} passa de ${max} caracteres`] : [];

const obrigatorio = (rotulo: string, texto: string | undefined): string[] =>
  typeof texto === "string" && texto.trim() ? [] : [`${rotulo} é obrigatório`];

function conferirInterativo(it: Extract<SaidaWhatsapp, { type: "interactive" }>["interactive"]): string[] {
  const erros = [
    ...obrigatorio("body.text", it.body.text),
    ...tamanho("body.text", it.body.text, LIMITES_META.corpoInterativo),
    ...tamanho("footer.text", it.footer?.text, LIMITES_META.rodape),
    ...tamanho("header.text", it.header?.text, LIMITES_META.cabecalhoTexto),
  ];
  if (it.type === "button") {
    const botoes = it.action.buttons;
    if (botoes.length < 1 || botoes.length > LIMITES_META.botoesResposta)
      erros.push(`botões de resposta: de 1 a ${LIMITES_META.botoesResposta}`);
    const ids = new Set<string>();
    for (const b of botoes) {
      erros.push(...obrigatorio("reply.title", b.reply.title));
      erros.push(...tamanho("reply.title", b.reply.title, LIMITES_META.tituloBotao));
      erros.push(...tamanho("reply.id", b.reply.id, LIMITES_META.idBotao));
      if (ids.has(b.reply.id)) erros.push(`reply.id repetido: ${b.reply.id}`);
      ids.add(b.reply.id);
    }
  } else if (it.type === "list") {
    const secoes = it.action.sections;
    erros.push(...obrigatorio("action.button", it.action.button));
    erros.push(...tamanho("action.button", it.action.button, LIMITES_META.textoBotaoLista));
    if (secoes.length < 1 || secoes.length > LIMITES_META.secoesLista)
      erros.push(`seções da lista: de 1 a ${LIMITES_META.secoesLista}`);
    const linhas = secoes.flatMap((s) => s.rows);
    if (linhas.length < 1 || linhas.length > LIMITES_META.linhasLista)
      erros.push(`linhas da lista: de 1 a ${LIMITES_META.linhasLista} no total`);
    for (const s of secoes) {
      if (secoes.length > 1) erros.push(...obrigatorio("section.title", s.title));
      erros.push(...tamanho("section.title", s.title, LIMITES_META.tituloSecao));
    }
    for (const l of linhas) {
      erros.push(...obrigatorio("row.title", l.title));
      erros.push(...tamanho("row.title", l.title, LIMITES_META.tituloLinha));
      erros.push(...tamanho("row.description", l.description, LIMITES_META.descricaoLinha));
    }
  } else {
    const p = it.action.parameters;
    erros.push(...obrigatorio("display_text", p.display_text));
    erros.push(...tamanho("display_text", p.display_text, LIMITES_META.textoBotaoLink));
    if (!/^(https?:\/\/|\/)/.test(p.url))
      erros.push("url precisa ser http, https ou caminho do próprio site");
  }
  return erros;
}

/** Confere uma mensagem que a empresa envia. Lista vazia quando a Meta aceitaria. */
export function conferirSaida(m: SaidaWhatsapp): string[] {
  switch (m.type) {
    case "text":
      return [
        ...obrigatorio("text.body", m.text.body),
        ...tamanho("text.body", m.text.body, LIMITES_META.texto),
      ];
    case "interactive":
      return conferirInterativo(m.interactive);
    case "template":
      return obrigatorio("template.name", m.template.name);
  }
}
