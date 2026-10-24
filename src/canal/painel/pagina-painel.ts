/**
 * Página do painel do dono (issues #182 e #207), aberta pelo botão "Abrir painel" do WhatsApp. Servida
 * pelo Nest, como a dos bastidores, com as mesmas cores. Só mostra números que `/painel/dados` devolve
 * (centavos e pontos-base, formatados aqui com inteiros); dado ausente aparece como "sem dado" e dia
 * sem vendas importadas vira lacuna no gráfico, nunca zero. Nomes de produto e fornecedor vêm do
 * cadastro e de notas, então são escritos só com `textContent`. Sem fonte nem biblioteca externa: a
 * demonstração do pitch roda sem internet.
 */
export const PAGINA_PAINEL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel do Omnia</title>
<style>
  :root {
    --verde: #15803D; --verde-escuro: #14532D; --verde-claro: #DCFCE7;
    --vermelho: #DC2626; --vermelho-claro: #FEE2E2; --ambar: #D97706; --ambar-claro: #FEF3C7;
    --cinza: #6B7280; --borda: #E5E7EB; --fundo: #FFFFFF; --texto: #111827;
    --sombra: 0 1px 2px rgba(17, 24, 39, 0.04), 0 4px 14px rgba(17, 24, 39, 0.05);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--fundo); color: var(--texto); font: 16px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: grid; grid-template-columns: 232px minmax(0, 1fr); min-height: 100vh; }
  svg { display: block; }

  .lateral { background: var(--verde-escuro); color: #fff; padding: 28px 14px; position: sticky; top: 0; height: 100vh; }
  .logo { font-size: 2.1rem; font-weight: 800; letter-spacing: -0.03em; margin: 0 10px 34px; }
  .lateral nav { display: grid; gap: 6px; }
  .lateral a { display: flex; align-items: center; gap: 14px; color: rgba(255, 255, 255, 0.86); text-decoration: none; font-size: 1.05rem; padding: 12px 14px; border-radius: 12px; }
  .lateral a:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  .lateral a[aria-current="true"] { background: var(--verde); color: #fff; font-weight: 700; }
  .lateral svg { width: 22px; height: 22px; flex: none; }

  main { padding: 22px 30px 14px; display: grid; gap: 16px; align-content: start; min-width: 0; }
  .topo { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
  .topo h1 { margin: 0; font-size: 2.15rem; line-height: 1.15; font-weight: 800; letter-spacing: -0.02em; }
  .topo p { margin: 4px 0 0; color: var(--cinza); font-size: 1.08rem; }
  .botao { display: inline-flex; align-items: center; gap: 12px; background: var(--verde); color: #fff; text-decoration: none; font-weight: 700; font-size: 1.02rem; padding: 14px 22px; border-radius: 12px; box-shadow: var(--sombra); }
  .botao:hover { background: var(--verde-escuro); }
  .botao svg { width: 24px; height: 24px; }

  .cartao { background: #fff; border: 1px solid var(--borda); border-radius: 14px; box-shadow: var(--sombra); padding: 16px 20px; min-width: 0; }
  .numeros { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .numeros .cartao { display: flex; flex-direction: column; gap: 10px; }
  #dia { background: var(--verde-claro); border-color: #BBF7D0; }
  .titulo { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .titulo h2 { margin: 0; font-size: 1.25rem; font-weight: 700; }
  .titulo span { color: var(--cinza); font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .valor { margin: 0; font-size: 2.3rem; line-height: 1.1; font-weight: 800; letter-spacing: -0.025em; color: var(--verde-escuro); font-variant-numeric: tabular-nums; }
  .etiqueta { align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 8px; font-size: 0.95rem; font-weight: 600; line-height: 1.3; }
  .etiqueta b { font-weight: 800; }
  .etiqueta.alta { background: #BBF7D0; color: var(--verde-escuro); }
  .numeros .cartao:not(#dia) .etiqueta.alta { background: var(--verde-claro); }
  .etiqueta.queda { background: var(--vermelho-claro); color: #991B1B; }
  .etiqueta.neutra { background: #F3F4F6; color: var(--cinza); }
  .detalhes { margin: 4px 0 0; padding-top: 12px; border-top: 1px solid #BBF7D0; color: #374151; font-size: 1rem; font-variant-numeric: tabular-nums; }
  .grafico { margin-top: auto; }
  .grafico text { font: 12px Inter, ui-sans-serif, system-ui, sans-serif; fill: var(--cinza); }
  .ausente { color: var(--cinza); margin: 0; }

  .baixo { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) minmax(0, 1.38fr); align-items: start; }
  .baixo h2 { margin: 0; font-size: 1.45rem; font-weight: 800; letter-spacing: -0.015em; }
  .baixo h2.com-espaco { margin-bottom: 12px; }
  .sub { margin: 2px 0 10px; color: var(--cinza); font-size: 0.85rem; }
  .avisos { display: grid; gap: 10px; }
  .aviso { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 14px; align-items: start; border: 1px solid var(--borda); border-left: 6px solid var(--verde); border-radius: 10px; padding: 10px 14px; background: #fff; }
  .aviso.p1 { border-left-color: var(--vermelho); } .aviso.p1 .icone { color: var(--vermelho); }
  .aviso.p2 { border-left-color: var(--ambar); } .aviso.p2 .icone { color: var(--ambar); }
  .aviso.p3 .icone { color: var(--verde); }
  .icone { width: 36px; height: 36px; margin-top: 2px; }
  .aviso p { margin: 0; }
  .aviso b { font-weight: 700; }
  .ver { display: inline-block; margin-top: 4px; color: var(--verde); font-weight: 600; text-underline-offset: 3px; }
  .mais { margin-top: 10px; background: none; border: 1px solid var(--borda); border-radius: 10px; padding: 8px 14px; font: inherit; font-size: 0.92rem; color: var(--verde-escuro); font-weight: 600; cursor: pointer; }
  .mais:hover { background: #F9FAFB; }

  .tabela { border: 1px solid var(--borda); border-radius: 10px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--borda); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  th { background: #F9FAFB; color: var(--cinza); font-weight: 600; font-size: 0.92rem; }
  td { font-variant-numeric: tabular-nums; }
  td.nome { white-space: normal; font-weight: 600; }
  td.margem { color: var(--vermelho); font-weight: 800; }
  td.meta { color: var(--cinza); }
  .origem { display: block; margin-top: 2px; font-size: 0.78rem; font-weight: 400; color: var(--cinza); }
  .incerto { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 6px; background: var(--ambar-claro); color: #92400E; font-size: 0.8rem; font-weight: 600; }
  tr.realce td { background: var(--ambar-claro); transition: background 0.4s; }

  #erro:empty { display: none; }
  #erro { background: var(--vermelho-claro); border-color: #FECACA; color: #991B1B; font-weight: 600; }
  footer { color: var(--cinza); font-size: 0.82rem; padding-top: 2px; }
  section[id] { scroll-margin-top: 16px; }

  @media (max-width: 1100px) {
    .numeros { grid-template-columns: minmax(0, 1fr); }
    .baixo { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    body { grid-template-columns: minmax(0, 1fr); }
    .lateral { position: static; height: auto; display: flex; align-items: center; gap: 12px; padding: 12px 16px; flex-wrap: wrap; }
    .logo { margin: 0 8px 0 0; font-size: 1.6rem; }
    .lateral nav { display: flex; gap: 4px; flex-wrap: wrap; }
    .lateral a { padding: 8px 10px; font-size: 0.95rem; gap: 8px; }
    .lateral svg { width: 18px; height: 18px; }
    main { padding: 18px 16px; }
    .topo h1 { font-size: 1.7rem; }
    .valor { font-size: 2rem; }
    .botao { width: 100%; justify-content: center; }
  }
</style>
</head>
<body>
<aside class="lateral">
  <div class="logo">Omnia</div>
  <nav aria-label="Seções do painel">
    <a href="#resumo" aria-current="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 20v-6M12 20V8M18 20V4"/></svg>Resumo</a>
    <a href="#produtos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z"/><path d="M3.5 7.25L12 12l8.5-4.75M12 12v9.5"/></svg>Produtos</a>
    <a href="#avisos"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>Avisos</a>
  </nav>
</aside>
<main>
  <section id="resumo" class="topo">
    <div><h1 id="saudacao">Olá!</h1><p id="subtitulo">Carregando seus números…</p></div>
    <a id="whatsapp" class="botao" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.6 18.7z"/><path d="M9.2 8.6c0 3 2.6 5.8 5.8 6.1l1-1.4-1.9-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-1.9z"/></svg>Falar com o Omnia no WhatsApp</a>
  </section>
  <div id="erro" class="cartao" role="alert"></div>
  <div class="numeros">
    <section id="dia" class="cartao"><div class="titulo"><h2>Ontem</h2></div></section>
    <section id="semana" class="cartao"><div class="titulo"><h2>Semana</h2></div></section>
    <section id="mes" class="cartao"><div class="titulo"><h2>Mês</h2></div></section>
  </div>
  <div class="baixo">
    <section id="avisos" class="cartao"><h2 class="com-espaco">Precisa da sua atenção hoje</h2><div id="lista-avisos"></div></section>
    <section id="produtos" class="cartao"><h2>Produtos abaixo da meta de margem</h2><p class="sub">Preço médio dos últimos 30 dias contra o custo da nota mais recente</p><div id="margens"></div></section>
  </div>
  <footer>Números calculados pelo Omnia a partir das suas vendas, notas e extrato.</footer>
</main>
<script>
"use strict";
const $ = (id) => document.getElementById(id);
const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) e.setAttribute(k, String(attrs[k])); return e; };
const ausente = (v) => v !== null && typeof v === "object" && v.ausente === true;
// Centavos inteiros para "R$ 1.234,56" e pontos-base para "12,05%", sem ponto flutuante.
function reais(c) { const s = String(Math.abs(c)).padStart(3, "0"); return (c < 0 ? "-" : "") + "R$ " + s.slice(0, -2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".") + "," + s.slice(-2); }
function porcento(b) { const s = String(Math.abs(b)).padStart(3, "0"); const c = s.slice(-2); return (b < 0 ? "-" : "") + s.slice(0, -2) + (c === "00" ? "" : "," + c) + "%"; }
const inteiro = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".");
const dm = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const diaDaSemana = (d) => DIAS[new Date(d + "T12:00:00Z").getUTCDay()];
const ORIGEM = { foto_nota: "foto de nota", nfe: "NF-e", planilha: "planilha", banco: "banco", dono: "dono" };

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia!" : h < 18 ? "Boa tarde!" : "Boa noite!";
}

// Ícones de linha dos avisos, pelo tipo; a cor vem da prioridade (1 vermelho, 2 âmbar, demais verde).
const ALERTA = [["circle", { cx: 12, cy: 12, r: 9.5 }], ["path", { d: "M12 7v6M12 16.5v.5" }]];
const ATENCAO = [["path", { d: "M12 3.5L21.5 20h-19z" }], ["path", { d: "M12 10v4.5M12 17.2v.3" }]];
const SUBINDO = [["path", { d: "M3 17l6-6 4 4 8-8" }], ["path", { d: "M15 7h6v6" }]];
const DESCENDO = [["path", { d: "M3 7l6 6 4-4 8 8" }], ["path", { d: "M15 17h6v-6" }]];
const CAIXA = [["path", { d: "M12 2.5l8.5 4.75v9.5L12 21.5l-8.5-4.75v-9.5z" }], ["path", { d: "M3.5 7.25L12 12l8.5-4.75M12 12v9.5" }]];
const ICONES = {
  margem_abaixo_da_meta: ALERTA,
  reajuste_de_custo: ATENCAO,
  gasto_fora_do_padrao: ATENCAO,
  ticket_medio_em_queda: DESCENDO,
  giro_em_alta: SUBINDO,
  espaco_para_subir_preco: SUBINDO,
  estoque_parado: CAIXA,
};
function icone(tipo) {
  const s = svg("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round", class: "icone", "aria-hidden": "true" });
  for (const [tag, attrs] of ICONES[tipo] ?? ALERTA) s.append(svg(tag, attrs));
  return s;
}

function etiqueta(c, referencia) {
  if (ausente(c) || !c || c.variacao_bps === null) return el("span", "etiqueta neutra", "Sem base para comparar " + referencia);
  const e = el("span", "etiqueta");
  e.title = "Base: " + reais(c.base_centavos);
  if (c.variacao_bps === 0) { e.classList.add("neutra"); e.textContent = "Igual ao valor " + referencia; return e; }
  const cai = c.variacao_bps < 0;
  e.classList.add(cai ? "queda" : "alta");
  e.append(cai ? "▼ " : "▲ ", el("b", "", porcento(Math.abs(c.variacao_bps))), (cai ? " abaixo " : " acima ") + referencia);
  return e;
}

function cabecalho(s, titulo, periodo) {
  const t = el("div", "titulo");
  t.append(el("h2", "", titulo));
  if (periodo) t.append(el("span", "", periodo));
  s.replaceChildren(t);
}

// Barras dos dias da semana; dia sem dado é só um tracejado (lacuna), dia sem venda fica no zero.
function barras(serie) {
  const L = 340, A = 96, base = 76, alto = 70, passo = L / serie.length, larg = Math.round(passo * 0.62);
  const max = Math.max(0, ...serie.map((d) => d.faturamento_centavos ?? 0));
  const g = svg("svg", { viewBox: "0 0 " + L + " " + A, class: "grafico", role: "img", "aria-label": "Faturamento por dia da semana" });
  g.append(svg("line", { x1: 0, x2: L, y1: base + 0.5, y2: base + 0.5, stroke: "#E5E7EB" }));
  serie.forEach((d, i) => {
    const x = Math.round(i * passo + (passo - larg) / 2);
    const v = d.faturamento_centavos;
    let r;
    if (v === null) r = svg("rect", { x: x, y: base - 22, width: larg, height: 22, rx: 3, fill: "none", stroke: "#9CA3AF", "stroke-dasharray": "3 3" });
    else { const h = max === 0 ? 0 : Math.max(v > 0 ? 2 : 0, Math.round((v * alto) / max)); r = svg("rect", { x: x, y: base - h, width: larg, height: h, rx: 3, fill: "#15803D" }); }
    const dica = svg("title", {}); dica.textContent = diaDaSemana(d.data) + " " + dm(d.data) + ": " + (v === null ? "sem dado" : reais(v));
    r.append(dica);
    const rotulo = svg("text", { x: Math.round(i * passo + passo / 2), y: A - 4, "text-anchor": "middle" }); rotulo.textContent = diaDaSemana(d.data);
    g.append(r, rotulo);
  });
  return g;
}

// Linha do mês dia a dia; trechos sem dado quebram a linha em vez de cair a zero.
function linha(serie) {
  const L = 340, A = 96, topo = 8, base = 76, alto = base - topo, n = serie.length;
  const max = Math.max(0, ...serie.map((d) => d.faturamento_centavos ?? 0));
  const x = (i) => (n === 1 ? L / 2 : Math.round((i * L) / (n - 1)));
  const y = (v) => base - (max === 0 ? 0 : Math.round((v * alto) / max));
  const g = svg("svg", { viewBox: "0 0 " + L + " " + A, class: "grafico", role: "img", "aria-label": "Faturamento por dia do mês" });
  g.append(svg("line", { x1: 0, x2: L, y1: base + 0.5, y2: base + 0.5, stroke: "#E5E7EB" }));
  const trechos = [];
  let atual = [];
  serie.forEach((d, i) => { if (d.faturamento_centavos === null) { if (atual.length) trechos.push(atual); atual = []; } else atual.push([i, d]); });
  if (atual.length) trechos.push(atual);
  for (const t of trechos) {
    const pts = t.map(([i, d]) => x(i) + "," + y(d.faturamento_centavos));
    if (t.length > 1) {
      g.append(svg("polygon", { points: x(t[0][0]) + "," + base + " " + pts.join(" ") + " " + x(t[t.length - 1][0]) + "," + base, fill: "#DCFCE7", opacity: 0.8 }));
      g.append(svg("polyline", { points: pts.join(" "), fill: "none", stroke: "#15803D", "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    }
    for (const [i, d] of t) {
      const p = svg("circle", { cx: x(i), cy: y(d.faturamento_centavos), r: t.length > 1 ? 6 : 3, fill: t.length > 1 ? "transparent" : "#15803D" });
      const dica = svg("title", {}); dica.textContent = dm(d.data) + ": " + reais(d.faturamento_centavos);
      p.append(dica); g.append(p);
    }
  }
  if (n > 0) {
    const ini = svg("text", { x: 0, y: A - 4 }); ini.textContent = dm(serie[0].data);
    const fim = svg("text", { x: L, y: A - 4, "text-anchor": "end" }); fim.textContent = dm(serie[n - 1].data);
    g.append(ini, fim);
  }
  return g;
}

function cartaoDia(r) {
  const s = $("dia");
  cabecalho(s, "Ontem", ausente(r) ? "" : dm(r.valor.data));
  if (ausente(r)) { s.append(el("p", "ausente", r.motivo)); return; }
  const v = r.valor;
  const saldo = ausente(v.saldo_do_dia_centavos) ? "sem dado" : reais(v.saldo_do_dia_centavos);
  const partes = [inteiro(v.cupons) + (v.cupons === 1 ? " venda" : " vendas"), "Ticket médio " + (v.ticket_medio_centavos === null ? "sem venda" : reais(v.ticket_medio_centavos)), "Saldo do dia " + saldo];
  s.append(el("p", "valor", reais(v.faturamento_centavos)), etiqueta(v.comparacao_faturamento.media_7_dias_anteriores, "da média dos 7 dias anteriores"), el("p", "detalhes", partes.join("  ·  ")));
}

function cartaoPeriodo(id, titulo, r, referencia, serie, grafico) {
  const s = $(id);
  cabecalho(s, titulo, ausente(r) ? "" : dm(r.valor.inicio) + " a " + dm(r.valor.fim));
  if (ausente(r)) s.append(el("p", "ausente", r.motivo));
  else s.append(el("p", "valor", reais(r.valor.faturamento_centavos)), etiqueta(r.valor.comparacao_faturamento, referencia));
  if (serie.some((d) => d.faturamento_centavos !== null)) s.append(grafico(serie));
}

// Lista longa mostra os primeiros e um botão para o resto: a tela do pitch cabe em 1440x900.
function comMais(container, itens, limite, rotulo) {
  container.append(...itens.slice(0, limite));
  if (itens.length <= limite) return;
  const b = el("button", "mais", "Mostrar mais " + (itens.length - limite) + " " + rotulo);
  b.type = "button";
  b.addEventListener("click", () => { b.replaceWith(...itens.slice(limite)); });
  container.append(b);
}

function realcar(id) {
  const tr = $(id);
  if (!tr) return;
  tr.hidden = false;
  tr.scrollIntoView({ behavior: "smooth", block: "center" });
  tr.classList.add("realce");
  setTimeout(() => tr.classList.remove("realce"), 2200);
}

function avisos(d) {
  const a = $("lista-avisos");
  if (d.avisos.length === 0) { a.replaceChildren(el("p", "ausente", "Nada fora do normal hoje.")); return; }
  const naTabela = new Set(d.margens_abaixo_da_meta.map((p) => p.produto_id));
  const itens = d.avisos.map((x) => {
    const card = el("div", "aviso p" + Math.min(x.prioridade, 3));
    const corpo = el("div");
    const p = el("p");
    for (const t of x.frase) p.append(t.destaque ? el("b", "", t.texto) : t.texto);
    corpo.append(p);
    if (x.produto_id && naTabela.has(x.produto_id)) {
      const ver = el("a", "ver", "Ver detalhes");
      ver.href = "#produto-" + x.produto_id;
      ver.addEventListener("click", (e) => { e.preventDefault(); realcar("produto-" + x.produto_id); });
      corpo.append(ver);
    }
    card.append(icone(x.tipo), corpo);
    return card;
  });
  const lista = el("div", "avisos");
  comMais(lista, itens, 3, "avisos");
  a.replaceChildren(lista);
}

function margens(d) {
  const m = $("margens");
  if (d.margens_abaixo_da_meta.length === 0) { m.replaceChildren(el("p", "ausente", "Todos os produtos com venda e custo estão na meta ou acima.")); return; }
  const t = el("table"), cab = el("tr"), corpo = el("tbody");
  for (const h of ["Produto", "Margem", "Meta", "Preço médio", "Custo"]) cab.append(el("th", "", h));
  const thead = el("thead"); thead.append(cab);
  const linhas = d.margens_abaixo_da_meta.map((p) => {
    const tr = el("tr");
    tr.id = "produto-" + p.produto_id;
    const incerto = p.menor_confianca !== null && p.menor_confianca < d.limite_confianca;
    const nome = el("td", "nome", p.produto);
    // Regra 4: todo dado carrega a origem; custo de foto duvidosa vem marcado como incerto.
    nome.append(el("span", "origem", "Origem: " + p.origens.map((o) => ORIGEM[o] ?? o).join(", ")));
    if (incerto) { const tag = el("span", "incerto", "dado incerto"); tag.title = "Algum dado veio com confiança abaixo do limite. Confira a nota."; nome.append(tag); }
    tr.append(nome, el("td", "margem", porcento(p.margem_bps)), el("td", "meta", porcento(p.meta_bps)), el("td", "", reais(p.preco_medio_venda_centavos)), el("td", "", reais(p.custo_compra_mais_recente_centavos)));
    return tr;
  });
  // Linha além das primeiras fica oculta até "Mostrar mais" ou "Ver detalhes".
  const LIMITE = 5;
  linhas.forEach((tr, i) => { if (i >= LIMITE) tr.hidden = true; corpo.append(tr); });
  t.append(thead, corpo);
  const caixa = el("div", "tabela"); caixa.append(t);
  m.replaceChildren(caixa);
  if (linhas.length > LIMITE) {
    const b = el("button", "mais", "Mostrar mais " + (linhas.length - LIMITE) + " produtos");
    b.type = "button";
    b.addEventListener("click", () => { for (const tr of linhas) tr.hidden = false; b.remove(); });
    m.append(b);
  }
}

function desenhar(d) {
  $("subtitulo").textContent = d.comercio + "  ·  Seus números até " + dm(d.ate);
  cartaoDia(d.dia);
  cartaoPeriodo("semana", "Semana", d.semana, "da semana anterior", d.serie_semana, barras);
  cartaoPeriodo("mes", "Mês", d.mes, "do mesmo período do mês anterior", d.serie_mes, linha);
  avisos(d);
  margens(d);
}

for (const a of document.querySelectorAll(".lateral a")) {
  a.addEventListener("click", () => { for (const b of document.querySelectorAll(".lateral a")) b.removeAttribute("aria-current"); a.setAttribute("aria-current", "true"); });
}

async function carregar() {
  $("saudacao").textContent = saudacao();
  const comerciante = new URLSearchParams(location.search).get("comerciante");
  if (!comerciante) { $("erro").textContent = "Abra o painel pelo botão no WhatsApp (falta o comerciante no endereço)."; $("subtitulo").textContent = ""; return; }
  // Volta para a conversa do mesmo comerciante (a tela do WhatsApp servida pelo backend).
  $("whatsapp").href = "/whatsapp?comerciante=" + encodeURIComponent(comerciante);
  $("whatsapp").hidden = false;
  try {
    const r = await fetch("/painel/dados", { headers: { "X-Comerciante-Id": comerciante } });
    if (!r.ok) throw new Error("O painel respondeu " + r.status);
    desenhar(await r.json());
  } catch (e) {
    $("erro").textContent = e instanceof Error ? e.message : "Não foi possível carregar o painel.";
    $("subtitulo").textContent = "";
    $("whatsapp").hidden = true;
  }
}
carregar();
</script>
</body>
</html>
`;
