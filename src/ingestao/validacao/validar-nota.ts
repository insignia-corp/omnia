import { cnpjValido } from "../../lib/cnpj/cnpj";
import { centavos, multiplicar, somar } from "../../lib/dinheiro/dinheiro";
import { LIMITE_CONFIANCA_ITEM, type ExtracaoNota } from "../extracao/esquema-extracao";

/** Soma dos itens contra o total impresso: poucos centavos de diferença são arredondamento. */
export const TOLERANCIA_SOMA_CENTAVOS = 5;
/** Quantidade x unitário contra o total do item (arredondamento de 1 centavo). */
export const TOLERANCIA_ITEM_CENTAVOS = 1;
/** Notas mais velhas que isto não são plausíveis para o histórico de um comércio. */
export const IDADE_MAXIMA_DIAS = 366;
/** Confiança a que o documento ou o item cai quando uma conferência em código falha. */
export const CONFIANCA_REDUZIDA = 0.5;

export type CodigoMotivo =
  | "soma_diverge_do_total"
  | "item_nao_confere"
  | "cnpj_invalido"
  | "data_invalida"
  | "data_futura"
  | "data_antiga";

export interface MotivoValidacao {
  codigo: CodigoMotivo;
  mensagem: string;
  /** Posição do item na nota (a partir de 1), quando o motivo é de um item. */
  item?: number;
}

export interface OpcoesValidacao {
  /** Data de hoje (AAAA-MM-DD). Injetada para o resultado ser determinístico nos testes. */
  hoje: string;
  limiteConfiancaItem?: number;
  toleranciaSomaCentavos?: number;
}

export interface NotaValidada {
  /** A extração com as confianças reduzidas onde as conferências falharam. */
  extracao: ExtracaoNota;
  somaItensCentavos: number;
  motivos: MotivoValidacao[];
  /** Posições (a partir de 1) dos itens abaixo do limite de confiança, que geram pergunta ao dono. */
  itensParaRevisao: number[];
}

const DIA_MS = 86_400_000;

/** `item_de_compra.quantidade` é numeric(14,3): a conferência precisa usar o que o banco guarda. */
const CASAS_QUANTIDADE = 1000;

/** Arredonda a três casas, sem nunca chegar a zero (o banco exige quantidade positiva). */
function quantidadeGravavel(quantidade: number): number {
  return Math.max(1 / CASAS_QUANTIDADE, Math.round(quantidade * CASAS_QUANTIDADE) / CASAS_QUANTIDADE);
}

/** Verdadeiro só para datas que existem no calendário. `Date.parse` aceita "2026-02-31" e rola para março. */
export function dataDeCalendarioValida(data: string): boolean {
  const d = Date.parse(`${data}T00:00:00Z`);
  return !Number.isNaN(d) && new Date(d).toISOString().slice(0, 10) === data;
}

function diasDesde(data: string, hoje: string): number | null {
  if (!dataDeCalendarioValida(data)) return null;
  const h = Date.parse(`${hoje}T00:00:00Z`);
  if (Number.isNaN(h)) return null;
  return Math.round((h - Date.parse(`${data}T00:00:00Z`)) / DIA_MS);
}

/**
 * Conferências em código sobre a saída do modelo (issue #25, regra inviolável 5). O modelo nunca
 * confere o próprio resultado: divergência não descarta a nota, reduz a confiança e deixa o motivo.
 * A quantidade já sai com as três casas do banco, e é com ela que o item é conferido.
 * A função não altera a entrada.
 */
export function validarNota(entrada: ExtracaoNota, opcoes: OpcoesValidacao): NotaValidada {
  const limite = opcoes.limiteConfiancaItem ?? LIMITE_CONFIANCA_ITEM;
  const tolerancia = opcoes.toleranciaSomaCentavos ?? TOLERANCIA_SOMA_CENTAVOS;
  const motivos: MotivoValidacao[] = [];
  let confiancaDocumento = entrada.confianca_documento;
  const reduzirDocumento = () => {
    confiancaDocumento = Math.min(confiancaDocumento, CONFIANCA_REDUZIDA);
  };

  const itens = entrada.itens.map((original, indice) => {
    const item = { ...original, quantidade: quantidadeGravavel(original.quantidade) };
    const esperado = multiplicar(centavos(item.valor_unitario_centavos), item.quantidade);
    if (Math.abs(esperado - item.valor_total_centavos) <= TOLERANCIA_ITEM_CENTAVOS) return item;
    motivos.push({
      codigo: "item_nao_confere",
      item: indice + 1,
      mensagem: `Item ${indice + 1}: quantidade x valor unitário dá ${esperado} centavos, a nota traz ${item.valor_total_centavos}`,
    });
    return { ...item, confianca: Math.min(item.confianca, CONFIANCA_REDUZIDA) };
  });

  const somaItensCentavos = somar(...itens.map((i) => centavos(i.valor_total_centavos)));
  if (Math.abs(somaItensCentavos - entrada.total_centavos) > tolerancia) {
    motivos.push({
      codigo: "soma_diverge_do_total",
      mensagem: `A soma dos itens (${somaItensCentavos} centavos) difere do total da nota (${entrada.total_centavos})`,
    });
    reduzirDocumento();
  }

  if (!cnpjValido(entrada.fornecedor.cnpj)) {
    motivos.push({ codigo: "cnpj_invalido", mensagem: "CNPJ do fornecedor com dígito verificador inválido" });
    reduzirDocumento();
  }

  const idade = diasDesde(entrada.data_emissao, opcoes.hoje);
  if (idade === null) {
    motivos.push({ codigo: "data_invalida", mensagem: `Data de emissão inválida: ${entrada.data_emissao}` });
    reduzirDocumento();
  } else if (idade < 0) {
    motivos.push({ codigo: "data_futura", mensagem: `Data de emissão no futuro: ${entrada.data_emissao}` });
    reduzirDocumento();
  } else if (idade > IDADE_MAXIMA_DIAS) {
    motivos.push({
      codigo: "data_antiga",
      mensagem: `Data de emissão com mais de ${IDADE_MAXIMA_DIAS} dias`,
    });
    reduzirDocumento();
  }

  const itensParaRevisao = itens.flatMap((item, i) => (item.confianca < limite ? [i + 1] : []));
  return {
    extracao: { ...entrada, itens, confianca_documento: confiancaDocumento },
    somaItensCentavos,
    motivos,
    itensParaRevisao,
  };
}
