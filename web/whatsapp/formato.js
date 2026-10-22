/**
 * Formatação de texto do WhatsApp: *negrito*, _itálico_, ~riscado~, `código` e ```monoespaçado```.
 * Monta nós DOM (nunca innerHTML), então texto do dono ou do agente não vira marcação.
 */

const MARCAS = [
  { marca: "*", tag: "strong" },
  { marca: "_", tag: "em" },
  { marca: "~", tag: "s" },
  { marca: "`", tag: "code" },
];

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Igual ao app: a marca abre e fecha colada ao texto, e não fica no meio de uma palavra.
const PADROES = MARCAS.map(({ marca, tag }) => {
  const m = escapar(marca);
  return {
    tag,
    re: new RegExp(
      `(^|[^\\p{L}\\p{N}])${m}([^\\s${m}](?:[^${m}\\n]*?[^\\s${m}])?)${m}(?=[^\\p{L}\\p{N}]|$)`,
      "u",
    ),
  };
});

const LINK = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)]/g;

function comLinks(texto) {
  const nos = [];
  let ultimo = 0;
  for (const achado of texto.matchAll(LINK)) {
    if (achado.index > ultimo) nos.push(document.createTextNode(texto.slice(ultimo, achado.index)));
    const a = document.createElement("a");
    a.href = achado[0];
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = achado[0];
    nos.push(a);
    ultimo = achado.index + achado[0].length;
  }
  if (ultimo < texto.length) nos.push(document.createTextNode(texto.slice(ultimo)));
  return nos;
}

function inline(texto) {
  let melhor = null;
  for (const p of PADROES) {
    const achado = p.re.exec(texto);
    if (achado && (melhor === null || achado.index < melhor.achado.index)) melhor = { p, achado };
  }
  if (!melhor) return comLinks(texto);

  const { p, achado } = melhor;
  const inicio = achado.index + achado[1].length;
  const fim = achado.index + achado[0].length;
  const el = document.createElement(p.tag);
  if (p.tag === "code") el.textContent = achado[2];
  else el.append(...inline(achado[2]));
  return [...comLinks(texto.slice(0, inicio)), el, ...inline(texto.slice(fim))];
}

/**
 * @param {string} texto
 * @returns {Node[]}
 */
export function formatar(texto) {
  const nos = [];
  const partes = texto.split(/```([\s\S]*?)```/);
  partes.forEach((parte, i) => {
    if (i % 2 === 1) {
      const pre = document.createElement("code");
      pre.className = "mono";
      pre.textContent = parte;
      nos.push(pre);
    } else if (parte) {
      nos.push(...inline(parte));
    }
  });
  return nos;
}

/** Texto sem as marcas, para citações e prévias de uma linha. */
export function textoPlano(texto) {
  return texto.replace(/```/g, "").replace(/(^|\s)[*_~`]([^*_~`]+)[*_~`](?=\s|$|[.,!?])/g, "$1$2");
}
