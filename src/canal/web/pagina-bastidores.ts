import { FORMATADORES_PAGINA } from "../bastidores/formatadores-pagina";

/**
 * Página dos bastidores (issue #77): mostra à banca o agente decidindo. Servida pelo Nest, como a do
 * chat. Todo dado vem de nota, ferramenta ou modelo e pode trazer instrução maliciosa, então é escrito
 * só com `textContent`, nunca como HTML. O dinheiro chega em centavos inteiros e os formatadores
 * (`formatadores-pagina.ts`) usam só aritmética inteira. Sem CDN nem fonte externa: funciona offline.
 * Os tokens de cor são os mesmos do painel do dono.
 */
export const PAGINA_BASTIDORES = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omnia, bastidores</title>
<style>
  :root {
    --verde: #15803D; --verde-escuro: #14532D; --verde-claro: #DCFCE7;
    --vermelho: #DC2626; --vermelho-claro: #FEE2E2;
    --ambar: #D97706; --ambar-claro: #FEF3C7;
    --cinza: #6B7280; --borda: #E5E7EB; --fundo: #FFFFFF; --texto: #111827;
    --cinza-claro: #F3F4F6;
    --fonte: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    --raio: 14px;
    --sombra: 0 1px 2px rgba(17, 24, 39, 0.06), 0 1px 3px rgba(17, 24, 39, 0.04);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body { margin: 0; background: var(--fundo); color: var(--texto); font: 14px/1.45 var(--fonte); -webkit-font-smoothing: antialiased; }
  svg { display: block; flex: none; }
  button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
  button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--verde); outline-offset: 2px; }

  /* Barra lateral */
  aside { position: fixed; inset: 0 auto 0 0; width: 200px; background: var(--verde-escuro); color: #fff; padding: 22px 10px; display: flex; flex-direction: column; gap: 22px; z-index: 2; }
  .logo { padding: 0 12px; font-size: 24px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }
  .logo span { display: block; }
  nav { display: grid; gap: 4px; }
  nav a { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 10px; color: rgba(255, 255, 255, 0.82); text-decoration: none; font-weight: 500; }
  nav a:hover { background: rgba(255, 255, 255, 0.08); color: #fff; }
  nav a.ativo { background: var(--verde); color: #fff; }

  /* Conteúdo */
  main { margin-left: 200px; padding: 14px 22px 28px; display: grid; gap: 14px; }
  .topo { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; scroll-margin-top: 14px; }
  h1 { margin: 0; font-size: 30px; font-weight: 700; letter-spacing: -0.02em; }
  .comercio { display: flex; align-items: center; gap: 10px; min-width: 300px; border: 1px solid var(--borda); border-radius: 12px; padding: 7px 12px; background: var(--fundo); box-shadow: var(--sombra); }
  .comercio svg { color: var(--verde-escuro); }
  .comercio .nome { font-weight: 600; font-size: 15px; white-space: nowrap; max-width: 14rem; overflow: hidden; text-overflow: ellipsis; }
  .comercio input { flex: 1; min-width: 9rem; width: 11rem; border: 0; border-left: 1px solid var(--borda); padding: 3px 0 3px 10px; font: 12px var(--mono); color: var(--cinza); background: transparent; }
  .vivo { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: var(--verde-claro); color: var(--verde-escuro); font-weight: 600; }
  .vivo .ponto { width: 10px; height: 10px; border-radius: 50%; background: var(--verde); animation: pulso 1.8s ease-out infinite; }
  .vivo.fora { background: var(--cinza-claro); color: var(--cinza); }
  .vivo.fora .ponto { background: var(--cinza); animation: none; }
  @keyframes pulso { 0% { box-shadow: 0 0 0 0 rgba(21, 128, 61, 0.55); } 70% { box-shadow: 0 0 0 8px rgba(21, 128, 61, 0); } 100% { box-shadow: 0 0 0 0 rgba(21, 128, 61, 0); } }
  @media (prefers-reduced-motion: reduce) { .vivo .ponto { animation: none; } html { scroll-behavior: auto; } }
  #erro { display: none; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 12px; background: var(--vermelho-claro); color: var(--vermelho); font-weight: 500; }
  #erro.visivel { display: flex; }

  /* Cartões */
  .cartao { background: var(--fundo); border: 1px solid var(--borda); border-radius: var(--raio); box-shadow: var(--sombra); }
  .resumo { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
  .resumo .cartao { display: flex; align-items: center; gap: 16px; padding: 16px 18px; }
  .resumo .icone { width: 52px; height: 52px; border-radius: 12px; background: var(--cinza-claro); color: var(--cinza); display: grid; place-items: center; }
  .resumo .icone.ambar { background: var(--ambar-claro); color: var(--ambar); }
  .resumo .rotulo { color: var(--cinza); font-size: 14px; }
  .resumo .valor { font-size: 28px; font-weight: 700; line-height: 1.15; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .resumo .valor.ambar { color: var(--ambar); }
  .colunas { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 14px; align-items: start; }
  .direita { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; }
  .secao { padding: 16px 18px 18px; scroll-margin-top: 14px; }
  h2 { margin: 0 0 12px; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
  .vazio { display: flex; align-items: center; gap: 10px; padding: 18px; border: 1px dashed var(--borda); border-radius: 12px; color: var(--cinza); background: var(--cinza-claro); }

  /* Etiquetas e selos: cor sempre com texto */
  .etq { display: inline-flex; align-items: center; padding: 2px 11px; border-radius: 999px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .etq.verde { background: var(--verde-claro); color: var(--verde-escuro); }
  .etq.vermelho { background: var(--vermelho-claro); color: var(--vermelho); }
  .etq.ambar { background: var(--ambar-claro); color: #92400E; }
  .etq.cinza { background: var(--cinza-claro); color: var(--cinza); }
  .etq.prio { padding: 1px 9px; font-size: 12px; }
  .selo { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: #fff; flex: none; }
  .selo.verde { background: var(--verde); }
  .selo.vermelho { background: var(--vermelho); }
  .selo.ambar { background: var(--ambar); }
  .selo.cinza { background: var(--cinza); }
  .suave { color: var(--cinza); }

  /* Linha do tempo de execuções */
  .exec { border: 1px solid var(--borda); border-radius: 12px; margin-bottom: 8px; overflow: hidden; }
  .exec-cab { width: 100%; display: flex; align-items: center; gap: 12px; padding: 11px 14px; }
  .exec-cab:hover { background: #F9FAFB; }
  .seta { color: var(--cinza); transition: transform 0.15s; }
  .aberto > .cab .seta, .aberto > .exec-cab .seta { transform: rotate(90deg); }
  .exec-tit { flex: 1; min-width: 0; }
  .exec-tit .l1 { font-size: 15px; }
  .exec-tit .l1 b { font-weight: 700; margin-right: 2px; }
  .exec-tit .l2 { display: none; color: var(--cinza); font-size: 12.5px; }
  .exec.aberto .exec-tit .l2 { display: block; }
  .exec-met { display: flex; align-items: center; gap: 8px; color: var(--cinza); font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .exec-corpo { display: none; padding: 4px 14px 16px; border-top: 1px solid var(--borda); }
  .exec.aberto > .exec-corpo { display: block; }
  .rot { margin: 14px 0 6px; font-size: 13.5px; color: #374151; font-weight: 500; }
  .balao { display: inline-block; max-width: 85%; padding: 9px 14px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 9rem; overflow-y: auto; }
  .balao.dono { background: var(--cinza-claro); border-bottom-left-radius: 4px; font-size: 15px; }
  .balao.modelo { background: var(--cinza-claro); font: 12.5px var(--mono); }
  .envio { display: flex; justify-content: flex-end; }
  .balao.enviada { background: var(--verde-claro); border-bottom-right-radius: 4px; max-width: 78%; max-height: none; color: var(--texto); }
  .balao.enviada .hora { display: flex; justify-content: flex-end; align-items: center; gap: 4px; margin-top: 4px; font-size: 12px; color: var(--cinza); }
  .balao.enviada .hora svg { color: var(--verde); }

  .chamada { border: 1px solid var(--borda); border-radius: 10px; margin-bottom: 6px; background: var(--fundo); }
  .cab { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 10px; }
  .cab:hover { background: #F9FAFB; }
  .chamada .num { width: 16px; color: var(--cinza); font-variant-numeric: tabular-nums; }
  .chamada .nome { flex: 1; min-width: 0; font: 600 13.5px var(--mono); overflow: hidden; text-overflow: ellipsis; }
  .chamada .meta { display: flex; gap: 14px; color: var(--cinza); font-size: 13px; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .chamada .meta .baixa { color: var(--ambar); font-weight: 600; }
  .chamada-corpo { display: none; padding: 0 12px 10px 38px; }
  .chamada.aberto > .chamada-corpo { display: block; }
  .chamada .erro { margin: 0 0 8px; padding: 6px 10px; border-radius: 8px; background: var(--vermelho-claro); color: var(--vermelho); font-size: 13px; overflow-wrap: anywhere; }
  .json { border: 1px solid var(--borda); border-radius: 10px; background: #F9FAFB; }
  .json > .cab { padding: 7px 10px; font-size: 13px; color: #374151; }
  .json > .cab .seta { width: 14px; height: 14px; }
  .json-corpo { display: none; padding: 0 10px 10px; }
  .json.aberto > .json-corpo { display: block; }
  .json-corpo .tit { margin: 6px 0 3px; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--cinza); font-weight: 600; }
  pre.codigo { margin: 0; padding: 8px 10px; background: var(--fundo); border: 1px solid var(--borda); border-radius: 8px; font: 12.5px/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 6rem; overflow: auto; }
  pre.codigo .chave { color: #0F5C8A; }
  pre.codigo .texto { color: #7C3AED; }
  pre.codigo .num { color: var(--ambar); }
  pre.codigo .lit { color: var(--verde); }

  .caixa { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; font-size: 14px; overflow-wrap: anywhere; }
  .caixa.vermelho { background: var(--vermelho-claro); color: #991B1B; border: 1px solid #FECACA; }
  .caixa.verde { background: var(--verde-claro); color: var(--verde-escuro); border: 1px solid #BBF7D0; }
  .caixa.ambar { background: var(--ambar-claro); color: #78350F; border: 1px solid #FDE68A; align-items: flex-start; }
  .caixa .sub { color: var(--cinza); font-size: 13px; }

  /* Última nota */
  .nota-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .nota-cab .forn { font-size: 17px; font-weight: 700; }
  .nota-cab .cnpj { color: var(--cinza); font-size: 13.5px; }
  .confmedia { display: flex; align-items: center; gap: 10px; margin: 10px 0 12px; color: #374151; }
  .confmedia b { font-size: 17px; }
  .barra { flex: 1; height: 8px; border-radius: 999px; background: var(--borda); overflow: hidden; min-width: 40px; }
  .barra i { display: block; height: 100%; border-radius: 999px; background: var(--verde); }
  .barra i.baixa { background: var(--ambar); }
  .totais { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--borda); border-radius: 10px; margin-bottom: 12px; }
  .totais > div { padding: 10px 14px; }
  .totais > div + div { border-left: 1px solid var(--borda); }
  .totais .rotulo { color: var(--cinza); font-size: 13px; }
  .totais .valor { display: flex; align-items: center; gap: 8px; font-size: 21px; font-weight: 700; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; }
  .totais .ok { color: var(--verde); }
  .totais .nao { color: var(--vermelho); }
  table { width: 100%; border-collapse: collapse; border: 1px solid var(--borda); border-radius: 10px; overflow: hidden; font-variant-numeric: tabular-nums; }
  th { text-align: left; background: #F9FAFB; color: #374151; font-size: 13px; font-weight: 600; padding: 8px 10px; }
  td { padding: 8px 10px; border-top: 1px solid var(--borda); font-size: 13.5px; }
  td.desc { overflow-wrap: anywhere; }
  td.conf { white-space: nowrap; }
  td.conf .celula { display: flex; align-items: center; gap: 8px; }
  td.conf .barra { width: 48px; flex: none; }
  td.baixa .celula span { color: var(--ambar); font-weight: 600; }
  .espaco { height: 12px; }

  /* Candidatos a alerta */
  .alerta { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--borda); }
  .alerta:first-child { border-top: 0; padding-top: 2px; }
  .alerta .icone { width: 30px; color: var(--verde); }
  .alerta .texto { flex: 1; min-width: 0; }
  .alerta .linha1 { display: flex; align-items: center; gap: 8px; font-weight: 600; }
  .alerta .just { color: var(--cinza); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .alertas-lista { max-height: 22rem; overflow-y: auto; }

  @media (max-width: 1180px) {
    .colunas { grid-template-columns: minmax(0, 1fr); }
    .resumo { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 760px) {
    aside { position: static; width: auto; flex-direction: row; align-items: center; padding: 10px; gap: 10px; overflow-x: auto; }
    .logo { font-size: 17px; padding: 0 6px; white-space: nowrap; }
    .logo span { display: inline; }
    nav { display: flex; }
    nav a { padding: 8px 10px; white-space: nowrap; }
    main { margin-left: 0; padding: 12px; }
    .exec-cab { flex-wrap: wrap; }
    .exec-met { flex-wrap: wrap; white-space: normal; }
    .comercio { min-width: 0; width: 100%; }
  }
</style>
</head>
<body>
<aside>
  <div class="logo"><span>Omnia &middot;</span> <span>Bastidores</span></div>
  <nav aria-label="Seções">
    <a href="#ao-vivo" class="ativo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>Ao vivo</a>
    <a href="#execucoes"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>Execuções</a>
    <a href="#notas"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2z"/><path d="M8 8h8M8 12h8"/></svg>Notas</a>
    <a href="#alertas"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>Alertas</a>
  </nav>
</aside>
<main>
  <div class="topo" id="ao-vivo">
    <h1>Ao vivo</h1>
    <div class="comercio">
      <span id="icone-comercio"></span>
      <span class="nome" id="nome-comercio">Comerciante</span>
      <input id="comerciante" placeholder="id do comerciante" aria-label="id do comerciante" spellcheck="false" autocomplete="off">
    </div>
    <span class="vivo" id="vivo" role="status"><span class="ponto"></span><span id="vivo-texto">Ao vivo</span></span>
  </div>
  <div id="erro" role="alert"></div>
  <div class="resumo" id="resumo"></div>
  <div class="colunas">
    <section class="cartao secao" id="execucoes"><h2>Execuções do agente</h2><div id="lista-execucoes"></div></section>
    <div class="direita">
      <section class="cartao secao" id="notas"><h2>Última nota</h2><div id="nota"></div></section>
      <section class="cartao secao" id="alertas"><h2>Candidatos a alerta</h2><div id="lista-alertas"></div></section>
    </div>
  </div>
</main>
<script>
"use strict";
${FORMATADORES_PAGINA}
const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined && texto !== null) e.textContent = String(texto);
  return e;
}

// Ícones de linha, 24x24. Só caminhos fixos daqui; nenhum dado entra num ícone.
const ICONES = {
  loja: ["M3 9l1.5-5h15L21 9", "M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0", "M5 12v8h14v-8", "M10 20v-5h4v5"],
  executar: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M10 8l6 4-6 4z"],
  alerta: ["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  banco: ["M21 5c0 1.66-4 3-9 3S3 6.66 3 5s4-3 9-3 9 1.34 9 3z", "M21 12c0 1.66-4 3-9 3s-9-1.34-9-3", "M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"],
  relogio: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M12 6v6l4 2"],
  seta: ["M9 6l6 6-6 6"],
  ok: ["M5 12.5l4.5 4.5L19 7"],
  duplo: ["M2 13l4 4 8-9", "M10 16l1.5 1.5L21 8"],
  erro: ["M6 6l12 12", "M18 6L6 18"],
  aviso: ["M12 6v7", "M12 17.5h.01"],
  barras: ["M6 20V11", "M12 20V4", "M18 20v-6"],
  alta: ["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"],
  baixa: ["M23 18l-9.5-9.5-5 5L1 6", "M17 18h6v-6"],
  etiqueta: ["M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z", "M7 7h.01"],
  caixa: ["M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z", "M3.27 6.96L12 12.01l8.73-5.05", "M12 22.08V12"],
  nota: ["M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2z", "M8 8h8M8 12h8"],
};
const ICONE_DO_TIPO = {
  reajuste_de_custo: "alta", margem_abaixo_da_meta: "barras", espaco_para_subir_preco: "etiqueta",
  giro_em_alta: "alta", estoque_parado: "caixa", ticket_medio_em_queda: "baixa",
};
function icone(nome, tamanho, traco) {
  const s = document.createElementNS(SVG_NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", tamanho);
  s.setAttribute("height", tamanho);
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", traco || 2);
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  for (const d of ICONES[nome] || []) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    s.append(p);
  }
  return s;
}
// Selo redondo colorido com o ícone dentro, sempre junto de um texto ou de um rótulo acessível.
function selo(cor, nome, rotulo) {
  const e = el("span", "selo " + cor);
  e.append(icone(nome, 14, 3));
  e.setAttribute("role", "img");
  e.setAttribute("aria-label", rotulo);
  return e;
}
function etiqueta(r, extra) {
  return el("span", "etq " + r.cor + (extra ? " " + extra : ""), r.texto);
}

const num = (n) => String(n).replace(".", ",");
const conf = (c) => c.toFixed(2).replace(".", ",");
const hora = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const plural = (n, um, varios) => n + " " + (n === 1 ? um : varios);

// Estado da tela: o que o dono da demo abriu sobrevive ao polling, pelo id da execução e da chamada.
let abertos = new Set();
let vistas = new Set();
function chave(...partes) { return partes.join(":"); }
function alternavel(k, classe, cabecalho, corpo) {
  const raiz = el("div", classe + (abertos.has(k) ? " aberto" : ""));
  const cab = el("button", classe === "exec" ? "exec-cab" : "cab");
  cab.type = "button";
  cab.setAttribute("aria-expanded", abertos.has(k) ? "true" : "false");
  cab.append(...cabecalho);
  cab.addEventListener("click", () => {
    const aberto = raiz.classList.toggle("aberto");
    cab.setAttribute("aria-expanded", aberto ? "true" : "false");
    if (aberto) abertos.add(k); else abertos.delete(k);
  });
  raiz.append(cab, corpo);
  return raiz;
}
function setaIcone() { const s = el("span", "seta"); s.append(icone("seta", 18)); return s; }

function jsonColorido(valor) {
  const pre = el("pre", "codigo");
  let t = JSON.stringify(valor, null, 2);
  if (t === undefined) t = "sem dados";
  const cortado = t.length > 4000;
  if (cortado) t = t.slice(0, 4000);
  const re = /("(?:\\.|[^"\\])*"\s*:?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let ultimo = 0;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (m.index > ultimo) pre.append(document.createTextNode(t.slice(ultimo, m.index)));
    const tok = m[0];
    let cls = "num";
    if (tok[0] === '"') cls = /:\s*$/.test(tok) ? "chave" : "texto";
    else if (/^(true|false|null)$/.test(tok)) cls = "lit";
    pre.append(el("span", cls, tok));
    ultimo = re.lastIndex;
  }
  if (ultimo < t.length) pre.append(document.createTextNode(t.slice(ultimo)));
  if (cortado) pre.append(document.createTextNode("\n... (cortado)"));
  return pre;
}

function vazio(texto) {
  const e = el("div", "vazio");
  e.append(icone("nota", 20), el("span", undefined, texto));
  return e;
}

/* ---------- Cartões de resumo do dia ---------- */
function cartaoResumo(nomeIcone, rotulo, valor, ambar) {
  const c = el("div", "cartao");
  const i = el("div", "icone" + (ambar ? " ambar" : ""));
  i.append(icone(nomeIcone, 26, 1.8));
  const t = el("div");
  t.append(el("div", "rotulo", rotulo), el("div", "valor" + (ambar ? " ambar" : ""), valor));
  c.append(i, t);
  return c;
}
function desenharResumo(r) {
  $("resumo").replaceChildren(
    cartaoResumo("executar", "Execuções hoje", r.execucoes),
    cartaoResumo("alerta", "Bloqueios do verificador", r.bloqueios_verificador, r.bloqueios_verificador > 0),
    cartaoResumo("banco", "Custo hoje", dolares(r.custo_microdolares, 2)),
    cartaoResumo("relogio", "Latência média", latencia(r.latencia_media_ms)),
  );
}

/* ---------- Execuções ---------- */
function blocoVerificador(e) {
  const v = e.verificador;
  const partes = [];
  const terminouBloqueado = e.resultado === "fallback_verificador";
  let titulo = "Verificador: aprovou de primeira";
  if (v.bloqueios > 0) {
    titulo = "Verificador: " + plural(v.bloqueios, "bloqueio", "bloqueios") + (terminouBloqueado ? ", sem versão aprovada" : ", regenerado");
  } else if (e.resultado !== "aprovada") {
    titulo = "Verificador: não chegou a aprovar";
  }
  partes.push(el("div", "rot", titulo));
  for (const t of v.tentativas) {
    const nums = t.numeros.join(", ");
    const c = el("div", "caixa vermelho");
    c.append(selo("vermelho", "aviso", "Bloqueio"),
      el("span", undefined, (t.numeros.length === 1 ? "O número " : "Os números ") + nums + (t.numeros.length === 1 ? " não aparece" : " não aparecem") + " nos resultados das ferramentas."));
    partes.push(c);
  }
  if (terminouBloqueado) {
    const c = el("div", "caixa vermelho");
    c.append(selo("vermelho", "erro", "Bloqueada"), el("span", undefined, "Terminou bloqueado: o dono recebeu a mensagem padrão do verificador."));
    partes.push(c);
  } else if (e.resultado === "aprovada") {
    const c = el("div", "caixa verde");
    c.append(selo("verde", "ok", "Aprovada"), el("span", undefined, v.bloqueios === 0 ? "Aprovada na 1ª tentativa." : (v.bloqueios + 1) + "ª tentativa aprovada."));
    partes.push(c);
  }
  return partes;
}

function blocoChamada(e, c, limite) {
  const k = chave("c", e.id, c.ordem);
  const jk = chave("j", e.id, c.ordem);
  const corpo = el("div", "chamada-corpo");
  if (c.erro) corpo.append(el("div", "erro", "Erro: " + c.erro));
  const jcorpo = el("div", "json-corpo");
  jcorpo.append(el("div", "tit", "Entrada"), jsonColorido(c.entrada), el("div", "tit", "Saída"), jsonColorido(c.saida));
  const jraiz = alternavel(jk, "json", [setaIcone(), el("span", undefined, "Entrada e saída \u00b7 JSON")], jcorpo);
  corpo.append(jraiz);
  const meta = el("span", "meta");
  meta.append(el("span", undefined, c.latencia_ms + " ms"));
  if (c.menor_confianca !== null) {
    meta.append(el("span", c.menor_confianca < limite ? "baixa" : "", "confiança " + conf(c.menor_confianca)));
  }
  const status = c.erro ? selo("vermelho", "erro", "Erro") : selo("verde", "ok", "Sucesso");
  return alternavel(k, "chamada", [setaIcone(), el("span", "num", c.ordem), status, el("span", "nome", c.ferramenta), meta], corpo);
}

function desenharExecucao(e, limite) {
  const resultado = rotuloResultado(e.resultado, e.gatilho);
  const semMensagem = e.gatilho === "extracao_nota" || e.gatilho === "vinculo_produto";
  const corpo = el("div", "exec-corpo");
  corpo.append(el("div", "rot", e.gatilho === "mensagem_dono" ? "Mensagem do dono" : "Entrada"));
  corpo.append(el("div", "balao dono", e.entrada));
  if (e.erro) {
    const c = el("div", "caixa vermelho");
    c.style.marginTop = "10px";
    c.append(selo("vermelho", "erro", "Erro"), el("span", undefined, "Erro: " + e.erro));
    corpo.append(c);
  }
  corpo.append(el("div", "rot", e.chamadas.length ? "Chamadas de ferramenta" : "Sem chamadas de ferramenta"));
  for (const c of e.chamadas) corpo.append(blocoChamada(e, c, limite));
  if (!semMensagem) corpo.append(...blocoVerificador(e));
  if (e.mensagem_final) {
    corpo.append(el("div", "rot", semMensagem ? "Resposta do modelo" : "Mensagem enviada"));
    if (semMensagem) {
      corpo.append(el("div", "balao modelo", e.mensagem_final));
    } else {
      const envio = el("div", "envio");
      const b = el("div", "balao enviada");
      const h = el("div", "hora");
      h.append(el("span", undefined, hora(e.criada_em)), icone("duplo", 16, 2.4));
      b.append(el("div", undefined, e.mensagem_final), h);
      envio.append(b);
      corpo.append(envio);
    }
  }
  const tokens = e.tokens.entrada + e.tokens.saida;
  const titulo = el("div", "exec-tit");
  const l1 = el("div", "l1");
  l1.append(el("b", undefined, hora(e.criada_em)), document.createTextNode(" \u00b7 gatilho: " + rotuloGatilho(e.gatilho)));
  titulo.append(l1, el("div", "l2", "modelo " + e.modelo + " \u00b7 prompt " + e.versao_prompt + " \u00b7 " + plural(e.iteracoes, "iteração", "iterações")));
  const met = el("div", "exec-met");
  met.append(el("span", undefined, latencia(e.latencia_ms) + " \u00b7 " + milhares(tokens) + " tokens \u00b7 " + dolares(e.custo_microdolares, 3)), etiqueta(resultado));
  return alternavel(chave("e", e.id), "exec", [setaIcone(), titulo, met], corpo);
}

// A execução mais recente que a tela vê pela primeira vez abre sozinha, com a primeira chamada (o JSON abre no clique).
function abrirNovas(execucoes) {
  const novas = execucoes.filter((e) => !vistas.has(e.id));
  for (const e of execucoes) vistas.add(e.id);
  const maisRecente = novas.find((e) => e.id === execucoes[0].id);
  if (!maisRecente) return;
  abertos.add(chave("e", maisRecente.id));
  const primeira = maisRecente.chamadas[0];
  if (primeira) { abertos.add(chave("c", maisRecente.id, primeira.ordem)); }
}

function desenharExecucoes(painel) {
  const raiz = $("lista-execucoes");
  if (!painel.execucoes.length) { raiz.replaceChildren(vazio("Nenhuma execução do agente ainda.")); return; }
  abrirNovas(painel.execucoes);
  raiz.replaceChildren(...painel.execucoes.map((e) => desenharExecucao(e, painel.limite_confianca)));
}

/* ---------- Última nota ---------- */
function desenharNota(nota) {
  const raiz = $("nota");
  if (!nota) { raiz.replaceChildren(vazio("Nenhuma nota enviada ainda.")); return; }
  const filhos = [];
  const cab = el("div", "nota-cab");
  const quem = el("div");
  quem.append(el("div", "forn", nota.fornecedor ? nota.fornecedor.nome : "Fornecedor não identificado"));
  quem.append(el("div", "cnpj", nota.fornecedor && nota.fornecedor.cnpj ? "CNPJ " + nota.fornecedor.cnpj : (nota.tipo === "nfe" ? "NF-e" : "Foto de nota")));
  cab.append(quem, etiqueta(rotuloStatusExtracao(nota.status_extracao)));
  filhos.push(cab);

  if (nota.confianca_media !== null) {
    const m = el("div", "confmedia");
    const barra = el("div", "barra");
    const preenchida = el("i", nota.confianca_media < nota.limite_confianca ? "baixa" : "");
    preenchida.style.width = Math.max(0, Math.min(100, Math.round(nota.confianca_media * 100))) + "%";
    barra.append(preenchida);
    m.append(el("span", undefined, "Confiança média"), el("b", undefined, conf(nota.confianca_media)), barra);
    filhos.push(m);
  }

  if (nota.erro) {
    const c = el("div", "caixa vermelho");
    c.append(selo("vermelho", "erro", "Erro"), el("span", undefined, "Erro: " + nota.erro));
    filhos.push(c);
  }
  const motivos = Array.isArray(nota.motivos_validacao) ? nota.motivos_validacao : [];
  for (const m of motivos) {
    const c = el("div", "caixa vermelho");
    const texto = m && typeof m === "object" ? (m.mensagem || m.codigo || JSON.stringify(m)) : String(m);
    c.append(selo("vermelho", "aviso", "Conferência em código"), el("span", undefined, "Conferência em código: " + texto));
    filhos.push(c);
  }

  if (nota.total_centavos !== null || nota.soma_itens_centavos !== null) {
    const bate = nota.total_centavos !== null && nota.total_centavos === nota.soma_itens_centavos;
    const totais = el("div", "totais");
    const t1 = el("div");
    t1.append(el("div", "rotulo", "Total da nota"), el("div", "valor", reais(nota.total_centavos)));
    const t2 = el("div");
    const v2 = el("div", "valor");
    v2.append(el("span", undefined, reais(nota.soma_itens_centavos)));
    const marca = el("span", bate ? "ok" : "nao");
    marca.append(icone(bate ? "ok" : "erro", 22, 3));
    marca.setAttribute("role", "img");
    marca.setAttribute("aria-label", bate ? "Os valores batem" : "Os valores não batem");
    v2.append(marca);
    t2.append(el("div", "rotulo", "Soma dos itens"), v2);
    totais.append(t1, t2);
    filhos.push(totais);
  }

  if (nota.itens.length) {
    const tabela = el("table");
    const cabT = el("tr");
    for (const t of ["Descrição", "Qtd", "Valor", "Confiança"]) cabT.append(el("th", undefined, t));
    tabela.append(cabT);
    for (const i of nota.itens) {
      const linha = el("tr");
      const celula = el("td", "conf" + (i.abaixo_do_limite ? " baixa" : ""));
      const dentro = el("div", "celula");
      const barra = el("div", "barra");
      const preenchida = el("i", i.abaixo_do_limite ? "baixa" : "");
      preenchida.style.width = Math.max(0, Math.min(100, Math.round(i.confianca * 100))) + "%";
      barra.append(preenchida);
      dentro.append(el("span", undefined, conf(i.confianca)), barra);
      celula.append(dentro);
      linha.append(el("td", "desc", i.descricao_nota), el("td", undefined, num(i.quantidade) + (i.unidade && i.unidade !== "un" ? " " + i.unidade : "")),
        el("td", undefined, reais(i.valor_total_centavos)), celula);
      tabela.append(linha);
    }
    filhos.push(tabela);
    const atencao = nota.itens.filter((i) => i.abaixo_do_limite || i.revisao_pendente);
    if (atencao.length) {
      filhos.push(el("div", "espaco"));
      for (const i of atencao) {
        const c = el("div", "caixa ambar");
        c.append(selo("ambar", "aviso", "Atenção"));
        const t = el("div");
        const linha1 = i.descricao_nota + ": " + conf(i.confianca) + (i.abaixo_do_limite ? " \u00b7 abaixo do limite " + num(nota.limite_confianca) : "");
        t.append(el("div", undefined, linha1));
        if (i.revisao_pendente) t.append(el("div", "sub", "Revisão pendente."));
        c.append(t);
        filhos.push(c);
      }
    }
  } else if (!nota.erro) {
    filhos.push(vazio("Nota sem itens extraídos."));
  }
  raiz.replaceChildren(...filhos);
}

/* ---------- Candidatos a alerta ---------- */
const COR_PRIORIDADE = { 1: "vermelho", 2: "ambar" };
function desenharAlertas(painel) {
  const todos = [...painel.decisoes_sem_execucao, ...painel.execucoes.flatMap((e) => e.decisoes_alerta)];
  const raiz = $("lista-alertas");
  if (!todos.length) { raiz.replaceChildren(vazio("Nenhum candidato registrado ainda.")); return; }
  const lista = el("div", "alertas-lista");
  for (const a of todos) {
    const linha = el("div", "alerta");
    const ic = el("span", "icone");
    ic.append(icone(ICONE_DO_TIPO[a.tipo] || "alerta", 26, 1.8));
    const texto = el("div", "texto");
    const l1 = el("div", "linha1");
    l1.append(el("span", undefined, rotuloTipoAlerta(a.tipo)), el("span", "etq prio " + (COR_PRIORIDADE[a.prioridade] || "cinza"), "P" + a.prioridade));
    const just = el("div", "just" + (a.justificativa ? "" : " suave"), a.justificativa || "Sem justificativa registrada.");
    if (a.justificativa) just.title = a.justificativa;
    texto.append(l1, just);
    linha.append(ic, texto, etiqueta(rotuloStatusAlerta(a.status)));
    lista.append(linha);
  }
  raiz.replaceChildren(lista);
}

/* ---------- Topo, navegação e polling ---------- */
$("icone-comercio").append(icone("loja", 22, 1.8));
function conectado(sim, texto) {
  $("vivo").classList.toggle("fora", !sim);
  $("vivo-texto").textContent = texto;
}
function mostrarErro(msg) {
  $("erro").textContent = msg;
  $("erro").classList.toggle("visivel", !!msg);
}

for (const a of document.querySelectorAll("nav a")) {
  a.addEventListener("click", () => {
    for (const o of document.querySelectorAll("nav a")) o.classList.remove("ativo");
    a.classList.add("ativo");
  });
}

const guardado = (() => { try { return localStorage.getItem("comerciante") || ""; } catch { return ""; } })();
$("comerciante").value = new URLSearchParams(location.search).get("comerciante") || guardado;
$("comerciante").addEventListener("change", () => {
  try { localStorage.setItem("comerciante", $("comerciante").value.trim()); } catch {}
  versaoVista = null;
  abertos = new Set();
  vistas = new Set();
  limparTela();
  atualizar();
});

// Ao trocar de comerciante nada do anterior fica na tela, nem se a nova consulta falhar.
function limparTela() {
  $("nome-comercio").textContent = "Comerciante";
  $("resumo").replaceChildren();
  $("lista-execucoes").replaceChildren(vazio("Carregando…"));
  $("nota").replaceChildren(vazio("Carregando…"));
  $("lista-alertas").replaceChildren(vazio("Carregando…"));
}

let versaoVista = null;
async function atualizar() {
  const id = $("comerciante").value.trim();
  if (!id) {
    conectado(false, "Sem comerciante");
    $("lista-execucoes").replaceChildren(vazio("Informe o id do comerciante no topo para ver o agente trabalhando."));
    return;
  }
  // Aba em segundo plano não faz polling, mas a primeira carga sempre acontece.
  if (document.hidden && versaoVista !== null) return;
  try {
    const r = await fetch("/bastidores/painel?limite=10", { headers: { "X-Comerciante-Id": id } });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).message) || ("Erro " + r.status));
    const painel = await r.json();
    mostrarErro("");
    conectado(true, "Ao vivo");
    if (painel.versao === versaoVista) return;
    versaoVista = painel.versao;
    $("nome-comercio").textContent = painel.comerciante.nome || "Comerciante";
    desenharResumo(painel.resumo_do_dia);
    desenharExecucoes(painel);
    desenharNota(painel.ultima_nota);
    desenharAlertas(painel);
  } catch (e) {
    conectado(false, "Desconectado");
    mostrarErro(e.message);
  }
}

atualizar();
setInterval(atualizar, 3000);
</script>
</body>
</html>
`;
