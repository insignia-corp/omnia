export interface Perfil {
  nome: string;
  tipo_comercio: string;
  cidade: string;
  horario: string;
  /** Meta de margem informada pelo dono, em pontos-base (2500 = 25%). */
  meta_margem_bps: number;
}

export interface Fornecedor {
  id: string;
  nome: string;
  cnpj: string;
}

export interface Produto {
  sku: string;
  codigo_barras: string;
  nome: string;
  /** Como o fornecedor costuma abreviar o produto na nota. */
  descricao_nota: string;
  categoria: string;
  unidade: string;
  fornecedor_id: string;
  preco_venda_centavos: number;
  /** Peso relativo de venda, só usado pelo gerador de vendas. */
  peso_venda: number;
}

export interface ItemVenda {
  venda_id: string;
  data: string;
  hora: string;
  sku: string;
  quantidade: number;
  preco_unitario_centavos: number;
}

export interface ItemNota {
  sku: string;
  quantidade: number;
  custo_unitario_centavos: number;
}

export interface Transacao {
  id: string;
  data: string;
  valor_centavos: number;
  tipo: "entrada" | "saida";
  descricao: string;
  categoria: string;
}
