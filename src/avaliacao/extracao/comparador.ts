import { normalizarCnpj, identificadorValido } from "../../lib/cnpj/cnpj";
import {
  LIMITE_CONFIANCA_ITEM,
  type ExtracaoNota,
  type ItemExtraido,
} from "../../ingestao/extracao/esquema-extracao";

export type CampoDocumento = "fornecedor_nome" | "fornecedor_cnpj" | "data_emissao" | "total_centavos";
export type CampoItem =
  "descricao" | "quantidade" | "unidade" | "valor_unitario_centavos" | "valor_total_centavos";

export const CAMPOS_DOCUMENTO: CampoDocumento[] = [
  "fornecedor_nome",
  "fornecedor_cnpj",
  "data_emissao",
  "total_centavos",
];
export const CAMPOS_ITEM: CampoItem[] = [
  "descricao",
  "quantidade",
  "unidade",
  "valor_unitario_centavos",
  "valor_total_centavos",
];

export interface ComparacaoItem {
  /** Posição do item no gabarito, a partir de 1. */
  posicao: number;
  esperado: ItemExtraido;
  /** `null`: o item do gabarito não saiu na extração (omitido). */
  obtido: ItemExtraido | null;
  camposErrados: CampoItem[];
}

export interface ComparacaoNota {
  camposDocumento: Record<CampoDocumento, boolean>;
  /** O CNPJ extraído passa no dígito verificador (a conferência em código da nota). */
  cnpjObtidoValido: boolean;
  somaItensEsperadaCentavos: number;
  somaItensObtidaCentavos: number;
  /** Soma dos itens extraídos igual à soma dos itens do gabarito. */
  somaItensCorreta: boolean;
  itens: ComparacaoItem[];
  /** Itens extraídos que não correspondem a nenhum do gabarito. */
  itensSobrando: ItemExtraido[];
  confiancaDocumentoEsperada: number;
  confiancaDocumentoObtida: number;
  /** Campos comparados (`certos` conta os iguais ao gabarito). Item omitido conta todos os seus campos como errados. */
  campos: { certos: number; total: number };
}

/** Sem acento, maiúsculas e espaços colapsados: "Pão  quente" e "PAO QUENTE" são o mesmo texto. */
export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** A quantidade vai ao banco com 3 casas; comparar com a mesma precisão evita erro de ponto flutuante. */
const milesimos = (n: number) => Math.round(n * 1000);

const soma = (itens: ItemExtraido[]) => itens.reduce((s, i) => s + i.valor_total_centavos, 0);

function camposErrados(esperado: ItemExtraido, obtido: ItemExtraido): CampoItem[] {
  const errados: CampoItem[] = [];
  if (normalizarTexto(esperado.descricao) !== normalizarTexto(obtido.descricao)) errados.push("descricao");
  if (milesimos(esperado.quantidade) !== milesimos(obtido.quantidade)) errados.push("quantidade");
  if (normalizarTexto(esperado.unidade) !== normalizarTexto(obtido.unidade)) errados.push("unidade");
  if (esperado.valor_unitario_centavos !== obtido.valor_unitario_centavos)
    errados.push("valor_unitario_centavos");
  if (esperado.valor_total_centavos !== obtido.valor_total_centavos) errados.push("valor_total_centavos");
  return errados;
}

/**
 * Casa os itens do gabarito com os extraídos: primeiro pela descrição igual (a ordem da nota pode mudar),
 * depois os que sobraram um a um pela ordem. Assim uma descrição mal lida ainda é comparada com o item
 * certo, em vez de virar "omitido" mais "sobrando".
 */
function casarItens(esperados: ItemExtraido[], obtidos: ItemExtraido[]): Array<ItemExtraido | null> {
  const par: Array<ItemExtraido | null> = esperados.map(() => null);
  const usados = new Set<number>();
  esperados.forEach((e, i) => {
    const alvo = normalizarTexto(e.descricao);
    const j = obtidos.findIndex((o, k) => !usados.has(k) && normalizarTexto(o.descricao) === alvo);
    if (j >= 0) {
      par[i] = obtidos[j] ?? null;
      usados.add(j);
    }
  });
  const livres = obtidos.map((_, k) => k).filter((k) => !usados.has(k));
  for (let i = 0; i < esperados.length && livres.length > 0; i++) {
    if (par[i]) continue;
    const k = livres.shift();
    if (k !== undefined) {
      par[i] = obtidos[k] ?? null;
      usados.add(k);
    }
  }
  return par;
}

/**
 * Compara a extração com o gabarito (`fixtures/notas/nota-NN.esperado.json`). Função pura. Dinheiro em
 * centavos inteiros; texto sem acento e sem diferenciar maiúscula; CNPJ pelos caracteres, sem máscara.
 * O gabarito traz a confiança como marcador (1 ou 0,5), por isso aqui só se guarda o valor; o lado do
 * limite é decidido em `classificarConfianca`.
 */
export function compararNota(esperado: ExtracaoNota, obtido: ExtracaoNota): ComparacaoNota {
  const camposDocumento: Record<CampoDocumento, boolean> = {
    fornecedor_nome: normalizarTexto(esperado.fornecedor.nome) === normalizarTexto(obtido.fornecedor.nome),
    fornecedor_cnpj: normalizarCnpj(esperado.fornecedor.cnpj) === normalizarCnpj(obtido.fornecedor.cnpj),
    data_emissao: esperado.data_emissao === obtido.data_emissao,
    total_centavos: esperado.total_centavos === obtido.total_centavos,
  };
  const pares = casarItens(esperado.itens, obtido.itens);
  const itens: ComparacaoItem[] = esperado.itens.map((e, i) => {
    const o = pares[i] ?? null;
    return {
      posicao: i + 1,
      esperado: e,
      obtido: o,
      camposErrados: o ? camposErrados(e, o) : [...CAMPOS_ITEM],
    };
  });
  const casados = new Set(pares.filter((p): p is ItemExtraido => p !== null));
  const itensSobrando = obtido.itens.filter((o) => !casados.has(o));

  const certosDocumento = CAMPOS_DOCUMENTO.filter((c) => camposDocumento[c]).length;
  const certosItens = itens.reduce((s, i) => s + CAMPOS_ITEM.length - i.camposErrados.length, 0);
  const somaItensEsperadaCentavos = soma(esperado.itens);
  const somaItensObtidaCentavos = soma(obtido.itens);
  return {
    camposDocumento,
    cnpjObtidoValido: identificadorValido(obtido.fornecedor.cnpj),
    somaItensEsperadaCentavos,
    somaItensObtidaCentavos,
    somaItensCorreta: somaItensEsperadaCentavos === somaItensObtidaCentavos,
    itens,
    itensSobrando,
    confiancaDocumentoEsperada: esperado.confianca_documento,
    confiancaDocumentoObtida: obtido.confianca_documento,
    campos: {
      certos: certosDocumento + certosItens,
      total: CAMPOS_DOCUMENTO.length + esperado.itens.length * CAMPOS_ITEM.length,
    },
  };
}

export type ErroDaNota =
  | { tipo: "documento"; campo: CampoDocumento }
  | { tipo: "item"; campo: CampoItem; posicao: number }
  | { tipo: "item_omitido"; posicao: number }
  | { tipo: "item_sobrando"; descricao: string };

/** Cada divergência da comparação, uma por campo errado. */
export function errosDaNota(c: ComparacaoNota): ErroDaNota[] {
  const erros: ErroDaNota[] = [];
  for (const campo of CAMPOS_DOCUMENTO)
    if (!c.camposDocumento[campo]) erros.push({ tipo: "documento", campo });
  for (const i of c.itens) {
    if (!i.obtido) erros.push({ tipo: "item_omitido", posicao: i.posicao });
    else for (const campo of i.camposErrados) erros.push({ tipo: "item", campo, posicao: i.posicao });
  }
  for (const s of c.itensSobrando) erros.push({ tipo: "item_sobrando", descricao: s.descricao });
  return erros;
}

export interface ClassificacaoConfianca {
  /** Erros que o dono seria avisado: item com confiança abaixo do limite, ou documento abaixo do limite. */
  errosSinalizados: ErroDaNota[];
  /** Erros que passariam sem pergunta ao dono: o que a meta quer em zero. */
  errosSilenciosos: ErroDaNota[];
  /** Posições (no gabarito, a partir de 1) dos itens extraídos abaixo do limite: viram pergunta ao dono. */
  itensAbaixoDoLimite: number[];
  /** Itens abaixo do limite com todos os campos certos que o gabarito dá como legíveis: pergunta desnecessária ao dono. */
  itensSinalizadosSemErro: number[];
  documentoAbaixoDoLimite: boolean;
}

/**
 * Onde a confiança deixa o erro passar. Regra: erro em campo de item é sinalizado quando o item sai abaixo
 * do limite; erro de documento (fornecedor, CNPJ, data, total), item omitido e item a mais, quando o
 * documento sai abaixo do limite. O item sinalizado em uma nota com documento abaixo do limite também
 * conta, porque o dono confirma a nota inteira (pergunta `confirmar_documento`).
 */
export function classificarConfianca(
  c: ComparacaoNota,
  limite = LIMITE_CONFIANCA_ITEM,
): ClassificacaoConfianca {
  const documentoAbaixoDoLimite = c.confiancaDocumentoObtida < limite;
  const abaixo = (i: ComparacaoItem) => i.obtido !== null && i.obtido.confianca < limite;
  const sinalizado = (e: ErroDaNota): boolean => {
    if (e.tipo === "item") {
      const item = c.itens[e.posicao - 1];
      return (item ? abaixo(item) : false) || documentoAbaixoDoLimite;
    }
    return documentoAbaixoDoLimite;
  };
  const erros = errosDaNota(c);
  return {
    errosSinalizados: erros.filter(sinalizado),
    errosSilenciosos: erros.filter((e) => !sinalizado(e)),
    itensAbaixoDoLimite: c.itens.filter(abaixo).map((i) => i.posicao),
    itensSinalizadosSemErro: c.itens
      .filter((i) => abaixo(i) && i.camposErrados.length === 0 && i.esperado.confianca >= limite)
      .map((i) => i.posicao),
    documentoAbaixoDoLimite,
  };
}
