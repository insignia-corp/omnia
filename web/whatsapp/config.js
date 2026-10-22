/**
 * Configuração da tela, lida da URL para não exigir build:
 * - `?modo=demo` (padrão hoje) ou `?modo=api` (backend, a integrar);
 * - `?painel=<url>` endereço do painel aberto pelo botão "Abrir painel";
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
  modo: params.get("modo") ?? "demo",
  painelUrl: params.get("painel") ?? "/painel",
  escala: Number.isFinite(escala) ? Math.min(Math.max(escala, 0.9), 2) : 1.3,
  tema: params.get("tema") ?? lerGuardado("tema") ?? "escuro",
};
