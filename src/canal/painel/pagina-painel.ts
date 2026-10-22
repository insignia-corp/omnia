/**
 * Página do painel do dono (issue #182), aberta pelo botão "Abrir painel" do WhatsApp. Servida pelo
 * Nest, como a dos bastidores. Só mostra números que `/painel/dados` devolve (centavos e pontos-base,
 * formatados aqui com inteiros); dado ausente aparece como "sem dado", nunca zero. Nomes de produto
 * vêm do cadastro e de notas, então são escritos só com `textContent`.
 */
export const PAGINA_PAINEL = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel do Omnia</title>
<style>
  :root { --fundo: #f0f2f5; --cartao: #fff; --texto: #111b21; --suave: #667781; --verde: #008069; --alta: #1f8a4c; --queda: #c0392b; --borda: #e2e5e8; }
  @media (prefers-color-scheme: dark) {
    :root:not([data-tema="claro"]) { --fundo: #0b141a; --cartao: #1f2c33; --texto: #e9edef; --suave: #8696a0; --verde: #00a884; --alta: #4cd187; --queda: #ff7b6b; --borda: #2a3942; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fundo); color: var(--texto); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header { background: var(--verde); color: #fff; padding: 16px; }
  header h1 { margin: 0; font-size: 1.25rem; }
  header p { margin: 2px 0 0; opacity: 0.85; font-size: 0.9rem; }
  main { max-width: 1040px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
  .cartoes { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
  section { background: var(--cartao); border: 1px solid var(--borda); border-radius: 12px; padding: 14px 16px; min-width: 0; }
  h2 { margin: 0 0 2px; font-size: 1rem; }
  .periodo { color: var(--suave); font-size: 0.85rem; margin: 0 0 10px; }
  .destaque { font-size: 1.9rem; font-weight: 700; font-variant-numeric: tabular-nums; margin: 0; }
  .comparacao { margin: 2px 0 10px; font-size: 0.9rem; }
  .alta { color: var(--alta); } .queda { color: var(--queda); }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin: 0; }
  dt { color: var(--suave); } dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--borda); }
  th:not(:first-child), td:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
  ul { margin: 0; padding-left: 18px; } li { margin: 4px 0; }
  .suave { color: var(--suave); }
  #erro { color: var(--queda); }
</style>
</head>
<body>
<header><h1 id="comercio">Painel do Omnia</h1><p id="subtitulo">Carregando seus números…</p></header>
<main>
  <div id="erro" role="alert"></div>
  <div class="cartoes">
    <section id="dia"><h2>Ontem</h2></section>
    <section id="semana"><h2>Semana</h2></section>
    <section id="mes"><h2>Mês</h2></section>
  </div>
  <section><h2>Produtos abaixo da meta de margem</h2><p class="periodo">Preço médio dos últimos 30 dias contra o custo da nota mais recente</p><div id="margens"></div></section>
  <section><h2>Avisos de hoje</h2><div id="avisos"></div></section>
</main>
<script>
"use strict";
const $ = (id) => document.getElementById(id);
const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
const ausente = (v) => v !== null && typeof v === "object" && v.ausente === true;
// Centavos inteiros para "R$ 1.234,56" e pontos-base para "12,05%", sem ponto flutuante.
function reais(c) { const s = String(Math.abs(c)).padStart(3, "0"); return (c < 0 ? "-" : "") + "R$ " + s.slice(0, -2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".") + "," + s.slice(-2); }
function porcento(b) { const s = String(Math.abs(b)).padStart(3, "0"); const c = s.slice(-2); return (b < 0 ? "-" : "") + s.slice(0, -2) + (c === "00" ? "" : "," + c) + "%"; }
const inteiro = (n) => String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".");
const dm = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
const ORIGEM = { foto_nota: "foto de nota", nfe: "NF-e", planilha: "planilha", banco: "banco", dono: "dono" };

function comparacao(c, referencia) {
  if (ausente(c) || !c || c.variacao_bps === null) return el("p", "comparacao suave", "Sem base para comparar " + referencia);
  if (c.variacao_bps === 0) return el("p", "comparacao suave", "= igual ao valor " + referencia + " (" + reais(c.base_centavos) + ")");
  const cai = c.variacao_bps < 0;
  return el("p", "comparacao " + (cai ? "queda" : "alta"), (cai ? "▼ " : "▲ ") + porcento(Math.abs(c.variacao_bps)) + (cai ? " abaixo " : " acima ") + referencia + " (" + reais(c.base_centavos) + ")");
}

function linhas(pares) {
  const dl = el("dl");
  for (const [rotulo, valor] of pares) { dl.append(el("dt", "", rotulo), el("dd", "", valor)); }
  return dl;
}
const dinheiroOuAusente = (v) => (ausente(v) ? "sem dado" : reais(v));

function cartao(id, titulo, r, periodo, comparar, referencia, saldoChave) {
  const s = $(id);
  s.replaceChildren(el("h2", "", titulo));
  if (ausente(r)) { s.append(el("p", "suave", r.motivo)); return; }
  const v = r.valor;
  s.append(el("p", "periodo", periodo(v)), el("p", "destaque", reais(v.faturamento_centavos)), comparar(v), linhas([
    ["Vendas (cupons)", inteiro(v.cupons)],
    ["Ticket médio", v.ticket_medio_centavos === null ? "sem venda" : reais(v.ticket_medio_centavos)],
    ["Gastos", dinheiroOuAusente(v.gastos_centavos)],
    ["Saldo", dinheiroOuAusente(v[saldoChave])],
  ]));
}

function desenhar(d) {
  $("comercio").textContent = d.comercio;
  $("subtitulo").textContent = "Números até " + dm(d.ate) + ", calculados pelo Omnia a partir das suas vendas, notas e extrato";
  cartao("dia", "Ontem", d.dia, (v) => "Dia " + dm(v.data), (v) => comparacao(v.comparacao_faturamento.media_7_dias_anteriores, "da média dos 7 dias anteriores"), "", "saldo_do_dia_centavos");
  cartao("semana", "Semana", d.semana, (v) => dm(v.inicio) + " a " + dm(v.fim), (v) => comparacao(v.comparacao_faturamento, "da semana anterior"), "", "saldo_do_periodo_centavos");
  cartao("mes", "Mês", d.mes, (v) => dm(v.inicio) + " a " + dm(v.fim), (v) => comparacao(v.comparacao_faturamento, "do mesmo período do mês anterior"), "", "saldo_do_periodo_centavos");

  const m = $("margens");
  if (d.margens_abaixo_da_meta.length === 0) m.replaceChildren(el("p", "suave", "Todos os produtos com venda e custo estão na meta ou acima."));
  else {
    const t = el("table");
    const cab = el("tr");
    for (const h of ["Produto", "Margem", "Meta", "Preço médio", "Custo", "Dados"]) cab.append(el("th", "", h));
    t.append(cab);
    for (const p of d.margens_abaixo_da_meta) {
      const tr = el("tr");
      const incerto = p.menor_confianca !== null && p.menor_confianca < d.limite_confianca;
      tr.append(el("td", "", p.produto), el("td", "queda", porcento(p.margem_bps)), el("td", "", porcento(p.meta_bps)), el("td", "", reais(p.preco_medio_venda_centavos)), el("td", "", reais(p.custo_compra_mais_recente_centavos)), el("td", incerto ? "queda" : "suave", (incerto ? "incerto: " : "") + p.origens.map((o) => ORIGEM[o] ?? o).join(", ")));
      t.append(tr);
    }
    m.replaceChildren(t);
  }

  const a = $("avisos");
  if (d.avisos.length === 0) a.replaceChildren(el("p", "suave", "Nada fora do normal hoje."));
  else {
    const ul = el("ul");
    for (const x of d.avisos) ul.append(el("li", "", x.rotulo + (x.produto ? ": " + x.produto : "") + (x.prioridade === 1 ? " (prioridade alta)" : "")));
    a.replaceChildren(ul);
  }
}

async function carregar() {
  const comerciante = new URLSearchParams(location.search).get("comerciante");
  if (!comerciante) { $("erro").textContent = "Abra o painel pelo botão no WhatsApp (falta o comerciante no endereço)."; $("subtitulo").textContent = ""; return; }
  try {
    const r = await fetch("/painel/dados", { headers: { "X-Comerciante-Id": comerciante } });
    if (!r.ok) throw new Error("O painel respondeu " + r.status);
    desenhar(await r.json());
  } catch (e) {
    $("erro").textContent = e instanceof Error ? e.message : "Não foi possível carregar o painel.";
  }
}
carregar();
</script>
</body>
</html>
`;
