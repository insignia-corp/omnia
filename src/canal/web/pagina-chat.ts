/**
 * Página do chat web (issue #66), servida pelo Nest para não depender de arquivo estático no build.
 * O navegador guarda o id do comerciante e o manda em `X-Comerciante-Id`, como qualquer cliente HTTP.
 */
export const PAGINA_CHAT = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omnia, chat do dono</title>
<style>
  :root { --fundo: #efeae2; --verde: #d9fdd3; --branco: #fff; --texto: #111b21; --suave: #667781; --barra: #008069; }
  @media (prefers-color-scheme: dark) {
    :root { --fundo: #0b141a; --verde: #005c4b; --branco: #202c33; --texto: #e9edef; --suave: #8696a0; --barra: #202c33; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; height: 100dvh; display: flex; flex-direction: column; background: var(--fundo); color: var(--texto); font: 16px/1.4 system-ui, sans-serif; }
  header { background: var(--barra); color: #fff; padding: 12px 16px; display: flex; gap: 8px; align-items: center; }
  header strong { flex: 1; }
  header input { width: 14rem; max-width: 45vw; padding: 4px 8px; border-radius: 6px; border: 0; }
  #mensagens { flex: 1; overflow-y: auto; padding: 12px 16px; display: flex; flex-direction: column; gap: 6px; }
  .bolha { max-width: 80%; padding: 8px 12px; border-radius: 10px; background: var(--branco); white-space: pre-wrap; overflow-wrap: anywhere; }
  .bolha.dono { align-self: flex-end; background: var(--verde); }
  .bolha small { display: block; color: var(--suave); font-size: 0.7rem; margin-top: 2px; }
  form { display: flex; gap: 8px; padding: 8px 16px; background: var(--branco); }
  form input[type=text] { flex: 1; padding: 10px 12px; border-radius: 20px; border: 1px solid var(--suave); background: transparent; color: inherit; }
  button, label.foto { padding: 8px 14px; border-radius: 20px; border: 0; background: var(--barra); color: #fff; cursor: pointer; }
  label.foto input { display: none; }
  #erro { color: #b3261e; padding: 0 16px; min-height: 1.2em; }
</style>
</head>
<body>
<header><strong>Omnia</strong><input id="comerciante" placeholder="id do comerciante" aria-label="id do comerciante"></header>
<div id="mensagens" aria-live="polite"></div>
<div id="erro" role="alert"></div>
<form id="form">
  <label class="foto">Nota<input id="arquivo" type="file" accept="image/jpeg,image/png"></label>
  <input id="texto" type="text" maxlength="4096" placeholder="Pergunte sobre o seu negócio" autocomplete="off">
  <button type="submit">Enviar</button>
</form>
<script>
const $ = (id) => document.getElementById(id);
const guardado = (() => { try { return localStorage.getItem("comerciante") || ""; } catch { return ""; } })();
$("comerciante").value = new URLSearchParams(location.search).get("comerciante") || guardado;
$("comerciante").addEventListener("change", () => {
  try { localStorage.setItem("comerciante", $("comerciante").value.trim()); } catch {}
  atualizar();
});
const cabecalhos = (extra) => ({ "X-Comerciante-Id": $("comerciante").value.trim(), ...extra });
const mostrarErro = (m) => { $("erro").textContent = m || ""; };

async function chamar(url, opcoes) {
  const r = await fetch(url, opcoes);
  if (!r.ok) {
    const corpo = await r.json().catch(() => ({}));
    throw new Error(corpo.message || ("Erro " + r.status));
  }
  return r.json();
}

function desenhar(lista) {
  const caixa = $("mensagens");
  const noFim = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 40;
  caixa.replaceChildren(...lista.map((m) => {
    const d = document.createElement("div");
    d.className = "bolha" + (m.direcao === "recebida" ? " dono" : "");
    d.textContent = m.texto;
    const h = document.createElement("small");
    h.textContent = new Date(m.criada_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    d.append(h);
    return d;
  }));
  if (noFim) caixa.scrollTop = caixa.scrollHeight;
}

async function atualizar() {
  if (!$("comerciante").value.trim()) return;
  try { desenhar(await chamar("/chat/mensagens", { headers: cabecalhos() })); mostrarErro(""); }
  catch (e) { mostrarErro(e.message); }
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const texto = $("texto").value.trim();
  if (!texto) return;
  $("texto").value = "";
  try {
    await chamar("/chat/mensagens", {
      method: "POST",
      headers: cabecalhos({ "Content-Type": "application/json" }),
      body: JSON.stringify({ id_externo: crypto.randomUUID(), texto }),
    });
    mostrarErro("");
  } catch (e) { mostrarErro(e.message); }
  atualizar();
});

$("arquivo").addEventListener("change", async () => {
  const arquivo = $("arquivo").files[0];
  if (!arquivo) return;
  const dados = new FormData();
  dados.append("arquivo", arquivo);
  try { await chamar("/chat/notas", { method: "POST", headers: cabecalhos(), body: dados }); mostrarErro(""); }
  catch (e) { mostrarErro(e.message); }
  $("arquivo").value = "";
  atualizar();
});

atualizar();
setInterval(atualizar, 3000);
</script>
</body>
</html>
`;
