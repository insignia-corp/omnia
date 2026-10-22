/**
 * Transporte do backend (issue #182): a mesma interface do de demonstração, falando com o Nest e o
 * PostgreSQL. A conversa mora no banco; aqui só fica o que a tela já mostrou (ids e status), para não
 * desenhar a mesma bolha duas vezes.
 *
 * - Identidade: `X-Comerciante-Id` (provisório, ver `src/comerciante/sessao.ts`) vindo de
 *   `?comerciante=` ou, sem ele, do comerciante do seed da demo (`GET /whatsapp/sessao`). Nunca do texto.
 * - Histórico e atualização: `GET /chat/mensagens?formato=whatsapp` a cada 1,5 s (mensagens novas,
 *   tiques e "digitando", tudo calculado no banco).
 * - Envio: texto, botão e linha de lista em `POST /chat/mensagens`; foto e XML em `POST /chat/notas`.
 * - Resumo das 7h: `POST /chat/proativa` (o mesmo serviço do job diário, no máximo 1 por dia).
 */
import { conferirSaida } from "./regras-meta.js";

const INTERVALO_MS = 1500;
const LIMITE_HISTORICO = 100;
const FOTO_INDISPONIVEL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="100%" height="100%" fill="#8696a0"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="18" text-anchor="middle">Foto da nota</text></svg>',
  );

/** Campos da mensagem do dono que vão ao backend, no formato do webhook da Cloud API. */
function paraWebhook(m) {
  const corpo = { id: m.id, type: m.type, [m.type]: m[m.type] };
  if (m.context) corpo.context = { id: m.context.id };
  return corpo;
}

async function lerErro(resposta) {
  try {
    const corpo = await resposta.json();
    return Array.isArray(corpo.message) ? corpo.message.join("; ") : (corpo.message ?? resposta.statusText);
  } catch {
    return resposta.statusText || `erro ${resposta.status}`;
  }
}

/**
 * @param {{ comerciante?: string | null }} config
 * @returns {Promise<import("./tipos.js").Transporte & { simularProativa(): Promise<string | null>, comercio: string }>}
 */
export async function criarTransporteApi(config) {
  const consulta = config.comerciante ? `?comerciante=${encodeURIComponent(config.comerciante)}` : "";
  const r = await fetch(`sessao${consulta}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(await lerErro(r));
  const sessao = await r.json();
  const cabecalhos = { "X-Comerciante-Id": sessao.comerciante_id };

  /** @type {((e: import("./tipos.js").Evento) => void)[]} */
  const ouvintes = [];
  /** id da mensagem -> último status mostrado */
  const conhecidas = new Map();
  /** id do documento -> endereço da foto já baixada ou escolhida neste navegador */
  const midias = new Map();
  let digitandoAgora = false;
  let mostrarDesde = 0;
  let consultando = null;

  const emitir = (e) => ouvintes.forEach((o) => o(e));

  async function api(caminho, opcoes = {}) {
    const resposta = await fetch(caminho, {
      ...opcoes,
      headers: { ...cabecalhos, ...(opcoes.headers ?? {}) },
    });
    if (!resposta.ok) throw new Error(await lerErro(resposta));
    return resposta.json();
  }

  async function foto(documentoId) {
    if (midias.has(documentoId)) return midias.get(documentoId);
    let link = FOTO_INDISPONIVEL;
    try {
      const resposta = await fetch(`/chat/notas/${encodeURIComponent(documentoId)}/arquivo`, {
        headers: cabecalhos,
      });
      if (resposta.ok) link = URL.createObjectURL(await resposta.blob());
    } catch {
      // Sem a foto (nota do seed, arquivo removido): a bolha mostra o marcador.
    }
    midias.set(documentoId, link);
    return link;
  }

  /**
   * Passa as mensagens do backend pela tela: as novas viram bolha (com a conferência das regras da
   * Meta, como no modo demonstração) e as já mostradas só avançam o status.
   * @returns {Promise<import("./tipos.js").Mensagem[]>} as novas, na ordem
   */
  async function absorver(lista, emitirNovas) {
    const novas = [];
    let ultimaDoDono = null;
    for (const m of [...lista].sort((a, b) => a.timestamp - b.timestamp)) {
      if (m.direcao === "entrada") ultimaDoDono = m.timestamp;
      if (m.timestamp < mostrarDesde && !conhecidas.has(m.id)) continue;
      if (conhecidas.has(m.id)) {
        if (m.direcao === "entrada" && m.status && conhecidas.get(m.id) !== m.status) {
          conhecidas.set(m.id, m.status);
          emitir({ tipo: "status", id: m.id, status: m.status });
        }
        continue;
      }
      conhecidas.set(m.id, m.status ?? null);
      if (m.type === "image" && m.image?.id && !m.image.link) m.image.link = await foto(m.image.id);
      if (m.direcao === "saida") {
        const recusa = conferirSaida(m, ultimaDoDono, m.timestamp);
        if (recusa.length) {
          m.recusada = recusa;
          console.warn("[regras da Meta]", recusa, m);
        }
      }
      novas.push(m);
      if (emitirNovas) emitir({ tipo: "mensagem", mensagem: m });
    }
    return novas;
  }

  async function consultar() {
    const dados = await api(`/chat/mensagens?formato=whatsapp&limite=${LIMITE_HISTORICO}`);
    await absorver(dados.mensagens, true);
    // "Digitando" vale enquanto o banco disser: a tela o desliga a cada bolha nova, então reenvia.
    if (dados.digitando || digitandoAgora) emitir({ tipo: "digitando", ativo: dados.digitando });
    digitandoAgora = dados.digitando;
  }

  /** Uma consulta por vez; pedidos durante uma consulta esperam por ela. */
  function atualizar() {
    consultando ??= consultar()
      .catch((e) => console.warn("[omnia] atualização falhou:", e))
      .finally(() => (consultando = null));
    return consultando;
  }

  return {
    nome: "backend",
    comercio: sessao.nome,
    async historico() {
      const dados = await api(`/chat/mensagens?formato=whatsapp&limite=${LIMITE_HISTORICO}`);
      const mensagens = await absorver(dados.mensagens, false);
      setInterval(() => void atualizar(), INTERVALO_MS);
      return mensagens;
    },
    async enviar(m, arquivo) {
      conhecidas.set(m.id, m.status ?? "sent");
      setTimeout(() => void atualizar(), 300);
      let dados;
      if (arquivo) {
        const corpo = new FormData();
        corpo.append("arquivo", arquivo);
        corpo.append("id", m.id);
        corpo.append("nome_arquivo", arquivo.name);
        const legenda = m.image?.caption ?? m.document?.caption;
        if (legenda) corpo.append("legenda", legenda);
        // A foto já está na tela; o histórico depois de recarregar baixa do backend.
        dados = await api("/chat/notas", { method: "POST", body: corpo });
        if (m.type === "image" && m.image?.link) midias.set(dados.documento_id, m.image.link);
      } else {
        dados = await api("/chat/mensagens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(paraWebhook(m)),
        });
      }
      await absorver(dados.mensagens ?? [], true);
    },
    aoEvento(ouvinte) {
      ouvintes.push(ouvinte);
    },
    /** Limpa só a tela: o histórico nunca é apagado (regra inviolável 10), e volta ao recarregar. */
    async reiniciar() {
      mostrarDesde = Date.now();
    },
    /** Relatório das 7h: o mesmo serviço do job diário (regra 9: no máximo 1 proativa por dia). */
    async simularProativa() {
      const r = await api("/chat/proativa", { method: "POST" });
      await atualizar();
      return r.aviso;
    },
  };
}
