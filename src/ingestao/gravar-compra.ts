import { and, asc, eq } from "drizzle-orm";
import { somenteDigitos } from "../lib/cnpj/cnpj";
import type { Db } from "../infra/database/database.module";
import { compra, documento, fornecedor, itemDeCompra } from "../infra/database/schema";
import type { ExtracaoNota } from "./extracao/esquema-extracao";
import type { NotaValidada } from "./validacao/validar-nota";

export interface EntradaGravacao {
  comercianteId: string;
  documentoId: string;
  /** Saída do modelo como veio, já validada pelo Zod. Fica no documento para auditoria. */
  extracaoOriginal: ExtracaoNota;
  validada: NotaValidada;
  limiteConfiancaItem: number;
}

export interface CompraGravada {
  compraId: string;
  status: "extraido" | "revisao";
  /** Itens abaixo do limite de confiança: cada um pede uma pergunta ao dono. */
  itensEmRevisao: Array<{ id: string; ordem: number }>;
  /** Verdadeiro quando um job repetido encontrou a compra já gravada. */
  jaExistia: boolean;
}

/**
 * Grava o resultado de uma extração numa transação só: fornecedor, compra, itens e o estado do
 * documento. Idempotente por documento (uma compra por documento), então uma nova tentativa do job
 * não duplica nada. Toda consulta filtra por `comerciante_id` (regra inviolável 3).
 *
 * `produto_id` fica nulo até a descrição ser ligada a um produto (issue #27), e por isso nenhuma
 * linha de `historico_custo` nasce aqui: o histórico só existe para item com produto.
 */
export async function gravarCompra(db: Db, e: EntradaGravacao): Promise<CompraGravada> {
  return db.transaction(async (tx) => {
    const existente = await tx
      .select({ id: compra.id })
      .from(compra)
      .where(and(eq(compra.comercianteId, e.comercianteId), eq(compra.documentoId, e.documentoId)))
      .limit(1);
    const doc = await tx
      .select({ status: documento.statusExtracao })
      .from(documento)
      .where(and(eq(documento.id, e.documentoId), eq(documento.comercianteId, e.comercianteId)))
      .limit(1);
    if (!doc[0]) throw new Error(`Documento ${e.documentoId} não existe para este comerciante`);

    const extracao = e.validada.extracao;
    const confiancaDocumento = extracao.confianca_documento;
    const emRevisao = (item: { confianca: number }) => item.confianca < e.limiteConfiancaItem;

    if (existente[0]) {
      const itens = await tx
        .select({ id: itemDeCompra.id, ordem: itemDeCompra.ordem, revisao: itemDeCompra.revisaoPendente })
        .from(itemDeCompra)
        .where(
          and(eq(itemDeCompra.comercianteId, e.comercianteId), eq(itemDeCompra.compraId, existente[0].id)),
        )
        .orderBy(asc(itemDeCompra.ordem));
      return {
        compraId: existente[0].id,
        status: doc[0].status === "revisao" ? "revisao" : "extraido",
        itensEmRevisao: itens.filter((i) => i.revisao).map(({ id, ordem }) => ({ id, ordem })),
        jaExistia: true,
      };
    }

    const cnpj = somenteDigitos(extracao.fornecedor.cnpj);
    await tx
      .insert(fornecedor)
      .values({
        comercianteId: e.comercianteId,
        nome: extracao.fornecedor.nome,
        cnpj,
        origem: "foto_nota",
        confianca: confiancaDocumento,
      })
      .onConflictDoNothing({ target: [fornecedor.comercianteId, fornecedor.cnpj] });
    const [forn] = await tx
      .select({ id: fornecedor.id })
      .from(fornecedor)
      .where(and(eq(fornecedor.comercianteId, e.comercianteId), eq(fornecedor.cnpj, cnpj)))
      .limit(1);
    if (!forn) throw new Error("Fornecedor não encontrado depois de gravar");

    const [novaCompra] = await tx
      .insert(compra)
      .values({
        comercianteId: e.comercianteId,
        documentoId: e.documentoId,
        fornecedorId: forn.id,
        data: extracao.data_emissao,
        totalCentavos: extracao.total_centavos,
        somaItensCentavos: e.validada.somaItensCentavos,
        origem: "foto_nota",
        confianca: confiancaDocumento,
      })
      .returning({ id: compra.id });
    if (!novaCompra) throw new Error("Falha ao gravar a compra");

    const itens = await tx
      .insert(itemDeCompra)
      .values(
        extracao.itens.map((item, indice) => ({
          comercianteId: e.comercianteId,
          compraId: novaCompra.id,
          ordem: indice + 1,
          descricaoNota: item.descricao,
          quantidade: item.quantidade,
          unidade: item.unidade,
          valorUnitarioCentavos: item.valor_unitario_centavos,
          valorTotalCentavos: item.valor_total_centavos,
          confianca: item.confianca,
          origem: "foto_nota" as const,
          revisaoPendente: emRevisao(item),
        })),
      )
      .returning({ id: itemDeCompra.id, ordem: itemDeCompra.ordem, revisao: itemDeCompra.revisaoPendente });

    const itensEmRevisao = itens.filter((i) => i.revisao).map(({ id, ordem }) => ({ id, ordem }));
    const status =
      itensEmRevisao.length > 0 || confiancaDocumento < e.limiteConfiancaItem ? "revisao" : "extraido";
    await tx
      .update(documento)
      .set({
        statusExtracao: status,
        confiancaMedia: confiancaDocumento,
        extracaoJson: e.extracaoOriginal,
        motivosValidacao: e.validada.motivos,
        erro: null,
        processadoEm: new Date(),
      })
      .where(and(eq(documento.id, e.documentoId), eq(documento.comercianteId, e.comercianteId)));

    return { compraId: novaCompra.id, status, itensEmRevisao, jaExistia: false };
  });
}
