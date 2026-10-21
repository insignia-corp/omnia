/**
 * Página dos bastidores (issue #77): mostra à banca o agente decidindo. Servida pelo Nest, como a do
 * chat. Todo dado vem de nota, ferramenta ou modelo e pode trazer instrução maliciosa, então é escrito
 * só com `textContent`, nunca como HTML. O dinheiro chega em centavos inteiros.
 */
export const PAGINA_BASTIDORES = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omnia, bastidores</title>
<style>
  :root { --fundo: #f6f7f8; --cartao: #fff; --texto: #111b21; --suave: #667781; --barra: #008069; --alerta: #b3261e; --borda: #d8dde0; }
  @media (prefers-color-scheme: dark) {
    :root { --fundo: #0b141a; --cartao: #202c33; --texto: #e9edef; --suave: #8696a0; --barra: #202c33; --alerta: #ff8a80; --borda: #33434c; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--fundo); color: var(--texto); font: 15px/1.45 system-ui, sans-serif; }
  header { background: var(--barra); color: #fff; padding: 12px 16px; display: flex; gap: 8px; align-items: center; }
  header strong { flex: 1; }
  header input { width: 14rem; max-width: 45vw; padding: 4px 8px; border-radius: 6px; border: 0; }
  main { max-width: 960px; margin: 0 auto; padding: 16px; display: grid; gap: 16px; }
  section { background: var(--cartao); border: 1px solid var(--borda); border-radius: 10px; padding: 12px 16px; }
  h2 { margin: 0 0 8px; font-size: 1rem; }
  details { border-top: 1px solid var(--borda); padding: 8px 0; }
  summary { cursor: pointer; }
  pre { margin: 4px 0; padding: 8px; background: var(--fundo); border-radius: 6px; overflow-x: auto; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 14rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--borda); }
  .baixa { color: var(--alerta); font-weight: 600; }
  .suave { color: var(--suave); }
  .passo { margin: 6px 0 6px 12px; }
  #erro { color: var(--alerta); min-height: 1.2em; }
</style>
</head>
<body>
<header><strong>Omnia, bastidores</strong><input id="comerciante" placeholder="id do comerciante" aria-label="id do comerciante"></header>
<main>
  <div id="erro" role="alert"></div>
  <section><h2>Última nota</h2><div id="nota"></div></section>
  <section><h2>Execuções do agente</h2><div id="execucoes"></div></section>
  <section><h2>Candidatos a alerta</h2><div id="alertas"></div></section>
</main>
<script>
const $ = (id) => document.getElementById(id);
const guardado = (() => { try { return localStorage.getItem("comerciante") || ""; } catch { return ""; } })();
$("comerciante").value = new URLSearchParams(location.search).get("comerciante") || guardado;
$("comerciante").addEventListener("change", () => {
  try { localStorage.setItem("comerciante", $("comerciante").value.trim()); } catch {}
  versaoVista = null;
  atualizar();
});

function el(tag, texto, classe) {
  const e = document.createElement(tag);
  if (texto !== undefined && texto !== null) e.textContent = String(texto);
  if (classe) e.className = classe;
  return e;
}

// Centavos inteiros viram "R$ 1.234,56" sem passar por ponto flutuante.
function reais(centavos) {
  if (centavos === null || centavos === undefined) return "sem valor";
  const sinal = centavos < 0 ? "-" : "";
  const s = String(Math.abs(centavos)).padStart(3, "0");
  const inteiros = s.slice(0, -2).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ".");
  return sinal + "R$ " + inteiros + "," + s.slice(-2);
}

function json(valor) {
  const t = JSON.stringify(valor, null, 2) ?? "sem dados";
  return t.length > 4000 ? t.slice(0, 4000) + "\\n... (cortado)" : t;
}

function desenharNota(nota) {
  const raiz = $("nota");
  if (!nota) { raiz.replaceChildren(el("p", "Nenhuma nota enviada ainda.", "suave")); return; }
  const filhos = [
    el("p", "Documento " + nota.tipo + ", extração: " + nota.status_extracao +
      (nota.confianca_media === null ? "" : ", confiança média " + nota.confianca_media.toFixed(2))),
  ];
  if (nota.erro) filhos.push(el("p", "Erro: " + nota.erro, "baixa"));
  if (nota.fornecedor) {
    filhos.push(el("p", "Fornecedor: " + nota.fornecedor.nome + (nota.fornecedor.cnpj ? " (CNPJ " + nota.fornecedor.cnpj + ")" : "") +
      ". Total da nota " + reais(nota.total_centavos) + ", soma dos itens " + reais(nota.soma_itens_centavos) + "."));
  }
  const motivos = Array.isArray(nota.motivos_validacao) ? nota.motivos_validacao : [];
  if (motivos.length) filhos.push(el("p", "Conferências em código: " + motivos.map((m) => m.codigo || json(m)).join(", "), "baixa"));
  if (nota.itens.length) {
    const tabela = el("table");
    const cab = el("tr");
    for (const t of ["#", "Descrição na nota", "Qtd", "Unitário", "Total", "Confiança", "Produto"]) cab.append(el("th", t));
    tabela.append(cab);
    for (const i of nota.itens) {
      const linha = el("tr");
      const conf = el("td", i.confianca.toFixed(2) + (i.abaixo_do_limite ? " (abaixo de " + nota.limite_confianca + ")" : ""),
        i.abaixo_do_limite ? "baixa" : "");
      linha.append(el("td", i.ordem), el("td", i.descricao_nota), el("td", i.quantidade + " " + i.unidade),
        el("td", reais(i.valor_unitario_centavos)), el("td", reais(i.valor_total_centavos)), conf,
        el("td", i.produto ? i.produto.nome : "sem vínculo", i.produto ? "" : "suave"));
      tabela.append(linha);
    }
    filhos.push(tabela);
  }
  raiz.replaceChildren(...filhos);
}

function desenharExecucao(e) {
  const d = el("details");
  const r = el("summary", e.gatilho + " | " + e.resultado + " | " + new Date(e.criada_em).toLocaleTimeString("pt-BR"));
  d.append(r);
  d.append(el("p", "Entrada: " + e.entrada));
  d.append(el("p", e.chamadas.length ? "Chamadas de ferramenta, em ordem:" : "Sem chamadas de ferramenta.", "suave"));
  for (const c of e.chamadas) {
    const p = el("div", undefined, "passo");
    p.append(el("strong", c.ordem + ". " + c.ferramenta + " (" + c.latencia_ms + " ms)"));
    if (c.erro) p.append(el("div", "Erro: " + c.erro, "baixa"));
    p.append(el("pre", "entrada: " + json(c.entrada)), el("pre", "saída: " + json(c.saida)));
    d.append(p);
  }
  const v = e.verificador;
  d.append(el("p", v.bloqueios
    ? "Verificador de números: bloqueou " + v.bloqueios + " vez(es). Números barrados: " + v.tentativas.map((t) => t.numeros.join(", ")).join(" | ")
    : "Verificador de números: aprovou de primeira.", v.bloqueios ? "baixa" : ""));
  d.append(el("p", "Mensagem final: " + e.mensagem_final));
  d.append(el("p", e.modelo + ", " + e.iteracoes + " iteração(ões), " + e.tokens.entrada + " tokens de entrada e " + e.tokens.saida + " de saída, " + e.latencia_ms + " ms", "suave"));
  return d;
}

function desenharAlertas(painel) {
  const todos = [...painel.decisoes_sem_execucao, ...painel.execucoes.flatMap((e) => e.decisoes_alerta)];
  const raiz = $("alertas");
  if (!todos.length) { raiz.replaceChildren(el("p", "Nenhum candidato registrado ainda.", "suave")); return; }
  raiz.replaceChildren(...todos.map((a) => {
    const d = el("details");
    d.append(el("summary", a.tipo + " | prioridade " + a.prioridade + " | " + a.status + " | " + a.data_referencia));
    d.append(el("p", a.justificativa ? "Justificativa: " + a.justificativa : "Sem justificativa registrada.", a.justificativa ? "" : "suave"));
    d.append(el("pre", json(a.metricas_apoio)));
    return d;
  }));
}

let versaoVista = null;
async function atualizar() {
  const id = $("comerciante").value.trim();
  if (!id || document.hidden) return;
  try {
    const r = await fetch("/bastidores/painel?limite=10", { headers: { "X-Comerciante-Id": id } });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).message) || ("Erro " + r.status));
    const painel = await r.json();
    $("erro").textContent = "";
    if (painel.versao === versaoVista) return;
    versaoVista = painel.versao;
    desenharNota(painel.ultima_nota);
    $("execucoes").replaceChildren(...(painel.execucoes.length
      ? painel.execucoes.map(desenharExecucao)
      : [el("p", "Nenhuma execução do agente ainda.", "suave")]));
    desenharAlertas(painel);
  } catch (e) { $("erro").textContent = e.message; }
}

atualizar();
setInterval(atualizar, 3000);
</script>
</body>
</html>
`;
