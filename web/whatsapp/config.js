/**
 * Configuração da tela, lida da URL para não exigir build:
 * - `?modo=api` (backend) ou `?modo=demo` (agente simulado). Sem o parâmetro, tenta o backend e, se
 *   não houver (servidor estático), cai na demonstração;
 * - `?comerciante=<id>` quem é o dono no modo api (sem ele, o comerciante do seed da demo);
 * - `?painel=<url>` endereço do painel no modo demonstração (no api, o backend manda o link);
 * - `?escala=1.4` tamanho da letra (a escolha no menu fica guardada neste navegador).
 */
const params = new URLSearchParams(location.search);

const lerGuardado = (chave) => {
  try {
    return localStorage.getItem(`omnia.${chave}`);
  } catch {
    return null;
  }
};

export const guardar = (chave, valor) => {
  try {
    localStorage.setItem(`omnia.${chave}`, String(valor));
  } catch {
    // Sem armazenamento (aba anônima, por exemplo): vale só nesta visita.
  }
};

const escala = Number(params.get("escala") ?? lerGuardado("escala") ?? "1.3");

export const CONFIG = {
  modo: params.get("modo") ?? "auto",
  comerciante: params.get("comerciante"),
  painelUrl: params.get("painel") ?? "/painel",
  escala: Number.isFinite(escala) ? Math.min(Math.max(escala, 0.9), 2) : 1.3,
  tema: params.get("tema") ?? lerGuardado("tema") ?? "escuro",
};
