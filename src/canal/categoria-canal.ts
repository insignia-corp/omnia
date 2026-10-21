export type CategoriaTemplate = "utilidade" | "marketing" | "servico" | "autenticacao";

const POR_NOME: Record<string, CategoriaTemplate> = {
  utility: "utilidade",
  utilidade: "utilidade",
  marketing: "marketing",
  service: "servico",
  servico: "servico",
  authentication: "autenticacao",
  autenticacao: "autenticacao",
};

/**
 * Categoria cobrada pelo canal para o enum do banco. O WhatsApp usa os nomes em inglês (`utility`,
 * `service`, `authentication`); aceita também os do banco. Valor desconhecido vira nulo.
 */
export function categoriaDoCanal(valor: string | null | undefined): CategoriaTemplate | null {
  if (!valor) return null;
  const chave = valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return POR_NOME[chave] ?? null;
}
