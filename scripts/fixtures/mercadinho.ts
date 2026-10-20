import { FORNECEDORES, PERFIL, PRODUTOS } from "./dados-base";
import { DIR_MERCADINHO, digitosCnpj, ean13, escreverJson } from "./lib/util";
import { resolve } from "node:path";

export interface FornecedorFixture {
  id: string;
  nome: string;
  cnpj: string;
  categoria: string;
}

export interface ProdutoFixture {
  id: string;
  nome: string;
  codigo_barras: string;
  unidade: string;
  categoria: string;
  preco_venda_centavos: number;
  fornecedor_principal_id: string;
}

export interface Mercadinho {
  perfil: typeof PERFIL;
  fornecedores: FornecedorFixture[];
  catalogo: ProdutoFixture[];
}

export function montarMercadinho(): Mercadinho {
  const fornecedores = FORNECEDORES.map((f) => ({
    id: f.id,
    nome: f.nome,
    cnpj: digitosCnpj(`${f.raiz_cnpj}0001`),
    categoria: f.categoria,
  }));
  const catalogo = PRODUTOS.map((produto, indice) => ({
    id: produto.id,
    nome: produto.nome,
    // Prefixo 299 (uso interno do GS1): não colide com produto real. O dígito verificador é válido.
    codigo_barras: ean13(`299${String(indice + 1).padStart(9, "0")}`),
    unidade: "un",
    categoria: produto.categoria,
    preco_venda_centavos: produto.preco,
    fornecedor_principal_id: produto.fornecedor,
  }));
  return { perfil: PERFIL, fornecedores, catalogo };
}

export function escreverMercadinho(m: Mercadinho): void {
  escreverJson(resolve(DIR_MERCADINHO, "perfil.json"), m.perfil);
  escreverJson(resolve(DIR_MERCADINHO, "fornecedores.json"), m.fornecedores);
  escreverJson(resolve(DIR_MERCADINHO, "catalogo.json"), m.catalogo);
}
