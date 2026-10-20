import { completarCnpj, formatarCnpj } from "../lib/cnpj/cnpj";
import type { Fornecedor, Perfil, Produto } from "./tipos";

/** Último dia fechado dos dados ("ontem" para quem pergunta em 2026-10-20). */
export const DATA_REFERENCIA = "2026-10-19";
/** 35 dias de vendas: 28 de base do giro mais 7 da semana comparada. */
export const INICIO_VENDAS = "2026-09-15";
/** 60 dias de extrato terminando na data de referência. */
export const INICIO_EXTRATO = "2026-08-21";

export const perfil: Perfil = {
  nome: "Mercadinho Bom Preço",
  tipo_comercio: "mercadinho",
  cidade: "Goiânia",
  horario: "Seg a Sáb 7h às 21h, Dom 8h às 13h",
  meta_margem_bps: 2500,
};

const fornecedoresBase: [string, string, string][] = [
  ["F1", "Distribuidora de Bebidas Cerrado Ltda", "345678120001"],
  ["F2", "Atacadão Grãos de Goiás Ltda", "456789230001"],
  ["F3", "Laticínios Vale Verde S.A.", "567890340001"],
  ["F4", "Panificadora Industrial Pão Dourado Ltda", "678901450001"],
  ["F5", "Higiene e Limpeza Brilho Ltda", "789012560001"],
  ["F6", "Hortifruti Central Goiás Ltda", "890123670001"],
  ["F7", "Doces e Snacks Planalto Ltda", "901234780001"],
];

export const fornecedores: Fornecedor[] = fornecedoresBase.map(([id, nome, base]) => ({
  id,
  nome,
  cnpj: formatarCnpj(completarCnpj(base)),
}));

/** Dígito verificador do EAN-13. */
function digitoEan13(base12: string): number {
  const soma = [...base12].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (soma % 10)) % 10;
}

const ABREVIACOES: [RegExp, string][] = [
  [/REFRIGERANTE/, "REFRIG"],
  [/BISCOITO/, "BISC"],
  [/INTEGRAL/, "INT"],
  [/FATIADO/, "FAT"],
  [/CONGELADO/, "CONG"],
  [/SABONETE/, "SAB"],
  [/DETERGENTE/, "DETERG"],
  [/MACARRAO/, "MAC"],
  [/ACHOCOLATADO/, "ACHOC"],
  [/MUSSARELA/, "MUSS"],
  [/SALGADINHO/, "SALG"],
  [/CHOCOLATE/, "CHOC"],
];

function descricaoDeNota(nome: string): string {
  let d = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  for (const [re, abrev] of ABREVIACOES) d = d.replace(re, abrev);
  return d;
}

// nome, categoria, unidade, fornecedor, preço de venda (centavos), peso de venda
type LinhaCatalogo = [string, string, string, string, number, number];

const catalogoBase: LinhaCatalogo[] = [
  ["Refrigerante Cola 2L", "bebidas", "un", "F1", 749, 10],
  ["Refrigerante Guaraná 2L", "bebidas", "un", "F1", 699, 6],
  ["Água Mineral 500ml", "bebidas", "un", "F1", 200, 8],
  ["Suco de Laranja 1L", "bebidas", "un", "F1", 599, 3],
  ["Cerveja Lata 350ml", "bebidas", "un", "F1", 349, 9],
  ["Energético 269ml", "bebidas", "un", "F1", 799, 2],
  ["Arroz Tipo 1 5kg", "mercearia", "un", "F2", 3190, 4],
  ["Feijão Carioca 1kg", "mercearia", "un", "F2", 899, 4],
  ["Açúcar Refinado 1kg", "mercearia", "un", "F2", 429, 4],
  ["Óleo de Soja 900ml", "mercearia", "un", "F2", 799, 4],
  ["Macarrão Espaguete 500g", "mercearia", "un", "F2", 349, 4],
  ["Farinha de Trigo 1kg", "mercearia", "un", "F2", 479, 3],
  ["Café Torrado 500g", "mercearia", "un", "F2", 1790, 5],
  ["Sal Refinado 1kg", "mercearia", "un", "F2", 249, 2],
  ["Molho de Tomate 340g", "mercearia", "un", "F2", 299, 3],
  ["Biscoito Recheado 130g", "mercearia", "un", "F2", 279, 5],
  ["Biscoito Cream Cracker 400g", "mercearia", "un", "F2", 499, 3],
  ["Leite em Pó 400g", "mercearia", "un", "F2", 2290, 2],
  ["Leite Integral 1L", "laticínios", "un", "F3", 549, 9],
  ["Queijo Mussarela Fatiado 150g", "laticínios", "un", "F3", 1190, 3],
  ["Presunto Fatiado 150g", "laticínios", "un", "F3", 999, 3],
  ["Iogurte Natural 170g", "laticínios", "un", "F3", 299, 4],
  ["Manteiga 200g", "laticínios", "un", "F3", 1290, 2],
  ["Requeijão Cremoso 200g", "laticínios", "un", "F3", 759, 2],
  ["Pão de Forma 500g", "padaria", "un", "F4", 749, 5],
  ["Bolo Caseiro 400g", "padaria", "un", "F4", 990, 2],
  ["Pão de Queijo Congelado 400g", "padaria", "un", "F4", 1590, 2],
  ["Torrada Integral 140g", "padaria", "un", "F4", 399, 2],
  ["Detergente Líquido 500ml", "limpeza", "un", "F5", 299, 4],
  ["Sabão em Pó 1kg", "limpeza", "un", "F5", 1590, 2],
  ["Água Sanitária 1L", "limpeza", "un", "F5", 399, 2],
  ["Papel Higiênico 4un", "higiene", "un", "F5", 899, 4],
  ["Esponja de Cozinha 3un", "limpeza", "un", "F5", 349, 2],
  ["Sabonete 85g", "higiene", "un", "F5", 199, 5],
  ["Creme Dental 90g", "higiene", "un", "F5", 399, 3],
  ["Shampoo 350ml", "higiene", "un", "F5", 1190, 1],
  ["Banana Prata (dúzia)", "hortifruti", "dz", "F6", 690, 4],
  ["Tomate Bandeja 500g", "hortifruti", "un", "F6", 690, 3],
  ["Cebola Saco 1kg", "hortifruti", "un", "F6", 590, 3],
  ["Batata Saco 1kg", "hortifruti", "un", "F6", 649, 3],
  ["Ovos Cartela 12un", "hortifruti", "un", "F6", 1090, 6],
  ["Limão Bandeja 500g", "hortifruti", "un", "F6", 549, 1],
  ["Salgadinho de Milho 100g", "snacks", "un", "F7", 649, 5],
  ["Chocolate em Barra 80g", "snacks", "un", "F7", 599, 5],
  ["Bala de Goma 100g", "snacks", "un", "F7", 349, 4],
  ["Chiclete 8un", "snacks", "un", "F7", 150, 3],
  ["Amendoim Salgado 150g", "snacks", "un", "F7", 449, 2],
  ["Pipoca de Micro-ondas 100g", "snacks", "un", "F7", 299, 3],
  ["Pirulito", "snacks", "un", "F7", 50, 3],
  ["Pilha AA 2un", "utilidades", "un", "F5", 799, 1],
];

export const catalogo: Produto[] = catalogoBase.map(
  ([nome, categoria, unidade, fornecedor_id, preco, peso], i) => {
    const base12 = `789${String(1000 + i).padStart(4, "0")}${String(10000 + i * 7).padStart(5, "0")}`;
    return {
      sku: `P${String(i + 1).padStart(3, "0")}`,
      codigo_barras: `${base12}${digitoEan13(base12)}`,
      nome,
      descricao_nota: descricaoDeNota(nome),
      categoria,
      unidade,
      fornecedor_id,
      preco_venda_centavos: preco,
      peso_venda: peso,
    };
  },
);

export const produtoPorSku = (sku: string): Produto => {
  const p = catalogo.find((x) => x.sku === sku);
  if (!p) throw new Error(`SKU desconhecido: ${sku}`);
  return p;
};

export const skuPorNome = (nome: string): string => {
  const p = catalogo.find((x) => x.nome === nome);
  if (!p) throw new Error(`Produto desconhecido: ${nome}`);
  return p.sku;
};
