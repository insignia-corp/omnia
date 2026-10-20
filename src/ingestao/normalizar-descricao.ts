/**
 * Descrição de nota em forma canônica: maiúsculas, sem acento, espaços e pontuação soltos
 * normalizados. Chave do vínculo descrição-produto e entrada da busca por similaridade.
 */
export function normalizarDescricao(descricao: string): string {
  return descricao.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
}
