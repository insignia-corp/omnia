import {
  CONFIANCA_REDUZIDA,
  TOLERANCIA_SOMA_CENTAVOS,
  type CodigoMotivo,
  type MotivoValidacao,
} from "../validacao/validar-nota";

/** Motivos que reduzem a confiança do documento inteiro, não só de um item. */
const MOTIVOS_DO_DOCUMENTO: readonly CodigoMotivo[] = [
  "soma_diverge_do_total",
  "cnpj_invalido",
  "data_invalida",
  "data_futura",
  "data_antiga",
];

export interface EstadoDocumento {
  motivos: MotivoValidacao[];
  /** Posição (a partir de 1) do item que o dono acabou de corrigir. */
  ordemCorrigida: number;
  /** Soma atual dos itens, depois da correção. */
  somaItensCentavos: number;
  totalCentavos: number;
  /** Confiança que o modelo deu ao documento, antes de qualquer redução feita em código. */
  confiancaOriginal: number;
  itensAindaEmRevisao: number;
  /** Menor confiança entre os itens da nota, já com a correção do dono. */
  menorConfiancaItem: number;
  limiteConfiancaItem: number;
}

export interface DocumentoRecalculado {
  motivos: MotivoValidacao[];
  confiancaDocumento: number;
  status: "extraido" | "revisao";
}

/**
 * Recalcula motivos, confiança e status do documento depois de o dono corrigir um item (issue #26).
 * O motivo daquele item sai (a correção vale por construção); o da soma é refeito contra o total
 * impresso, então corrigir uma leitura errada pode resolver a divergência e corrigir para pior a cria.
 * Os demais motivos do documento (CNPJ, data) continuam: o dono não os corrigiu.
 *
 * A confiança do documento que o modelo informa já embute a dúvida sobre o item ilegível. Quando o
 * último item duvidoso é resolvido e nenhum motivo de validação do documento resta, ela passa a
 * valer pelo menos a menor confiança dos itens; antes disso (ou com motivo restante) não sobe.
 */
export function recalcularDocumento(e: EstadoDocumento): DocumentoRecalculado {
  const motivos = e.motivos.filter(
    (m) => m.item !== e.ordemCorrigida && m.codigo !== "soma_diverge_do_total",
  );
  if (Math.abs(e.somaItensCentavos - e.totalCentavos) > TOLERANCIA_SOMA_CENTAVOS) {
    motivos.push({
      codigo: "soma_diverge_do_total",
      mensagem: `A soma dos itens (${e.somaItensCentavos} centavos) difere do total da nota (${e.totalCentavos})`,
    });
  }
  const reduzido = motivos.some((m) => MOTIVOS_DO_DOCUMENTO.includes(m.codigo));
  const confiancaDocumento = reduzido
    ? Math.min(e.confiancaOriginal, CONFIANCA_REDUZIDA)
    : e.itensAindaEmRevisao > 0
      ? e.confiancaOriginal
      : Math.max(e.confiancaOriginal, e.menorConfiancaItem);
  const status =
    e.itensAindaEmRevisao > 0 || confiancaDocumento < e.limiteConfiancaItem ? "revisao" : "extraido";
  return { motivos, confiancaDocumento, status };
}
