export const CAMPOS = [
  "data",
  "hora",
  "cupom",
  "codigo_barras",
  "produto",
  "quantidade",
  "preco_unitario",
  "total",
] as const;
export type Campo = (typeof CAMPOS)[number];

/** Sem estes quatro não dá para importar uma venda (guia: data, produto, quantidade, preço). */
export const CAMPOS_OBRIGATORIOS: readonly Campo[] = ["data", "produto", "quantidade", "preco_unitario"];

/** Campo do sistema para o nome da coluna na planilha, exatamente como está no cabeçalho. */
export type Mapeamento = Partial<Record<Campo, string>>;

/** Nomes comuns de cabeçalho (já normalizados) de PDVs e planilhas de comércio. */
const SINONIMOS: Record<Campo, readonly string[]> = {
  data: ["data", "dt", "dt venda", "data venda", "data da venda", "data emissao", "dt emissao", "dia"],
  hora: ["hora", "horario", "hr"],
  cupom: [
    "cupom",
    "numero cupom",
    "num cupom",
    "n cupom",
    "nr cupom",
    "cupom fiscal",
    "venda",
    "pedido",
    "comanda",
  ],
  codigo_barras: ["codigo de barras", "cod barras", "codigo barras", "ean", "gtin", "codigo", "cod"],
  produto: [
    "produto",
    "descricao",
    "descricao produto",
    "descricao do produto",
    "item",
    "nome",
    "mercadoria",
  ],
  quantidade: ["qtd", "qtde", "qte", "quant", "quantidade", "qtd vendida"],
  preco_unitario: [
    "preco unit",
    "preco unitario",
    "valor unit",
    "valor unitario",
    "vlr unit",
    "vlr unitario",
    "preco",
    "pu",
  ],
  total: ["total", "valor total", "vlr total", "subtotal", "total item"],
};

/** Minúsculas, sem acento, sem o que vem entre parênteses (unidade) e sem pontuação. */
export function normalizarCabecalho(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Identifica o "formato" da planilha: os cabeçalhos normalizados, em ordem alfabética. */
export function assinaturaDosCabecalhos(cabecalhos: readonly string[]): string {
  return cabecalhos.map(normalizarCabecalho).sort().join("|");
}

export interface SugestaoMapeamento {
  mapeamento: Mapeamento;
  /** Campos obrigatórios que nenhuma coluna parece cobrir. */
  faltando: Campo[];
}

/**
 * Sugere o mapeamento pelos nomes do cabeçalho. É só uma sugestão: o dono confirma uma vez e o
 * mapeamento fica salvo para as próximas planilhas do mesmo formato. Cada coluna serve a um campo.
 */
export function sugerirMapeamento(cabecalhos: readonly string[]): SugestaoMapeamento {
  const normalizados = cabecalhos.map(normalizarCabecalho);
  const usadas = new Set<number>();
  const mapeamento: Mapeamento = {};
  for (const campo of CAMPOS) {
    const indice = normalizados.findIndex((n, i) => !usadas.has(i) && SINONIMOS[campo].includes(n));
    if (indice < 0) continue;
    usadas.add(indice);
    mapeamento[campo] = cabecalhos[indice]!;
  }
  return { mapeamento, faltando: CAMPOS_OBRIGATORIOS.filter((c) => !mapeamento[c]) };
}

export type ErroMapeamento = { campo: Campo | "geral"; mensagem: string };

/** Confere um mapeamento enviado pelo dono contra os cabeçalhos reais da planilha. */
export function validarMapeamento(mapeamento: Mapeamento, cabecalhos: readonly string[]): ErroMapeamento[] {
  const erros: ErroMapeamento[] = [];
  const colunasUsadas = new Map<string, Campo>();
  for (const campo of CAMPOS) {
    const coluna = mapeamento[campo];
    if (!coluna) continue;
    if (!cabecalhos.includes(coluna)) {
      erros.push({ campo, mensagem: `A coluna "${coluna}" não existe na planilha` });
      continue;
    }
    const outro = colunasUsadas.get(coluna);
    if (outro) erros.push({ campo, mensagem: `A coluna "${coluna}" já está ligada a "${outro}"` });
    colunasUsadas.set(coluna, campo);
  }
  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (!mapeamento[campo]) erros.push({ campo, mensagem: `Falta indicar a coluna de "${campo}"` });
  }
  return erros;
}
