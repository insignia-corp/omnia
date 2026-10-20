import { and, asc, eq } from "drizzle-orm";
import { somenteDigitos } from "../lib/cnpj/cnpj";
import type { Db } from "../infra/database/database.module";
import {
  compra,
  documento,
  fornecedor,
  historicoCusto,
  itemDeCompra,
  perguntaDono,
} from "../infra/database/schema";
import type { ExtracaoNota } from "./extracao/esquema-extracao";
import { montarPerguntaItem, montarPerguntaVinculo } from "./revisao/perguntas";
import type { NotaValidada } from "./validacao/validar-nota";
import { buscarVinculo, registrarVinculo } from "./vinculo/vincular-produto";

export interface EntradaGravacao {
  comercianteId: string;
  documentoId: string;
  /** Saída do modelo como veio, já validada pelo Zod. Fica no documento para auditoria. */
  extracaoOriginal: ExtracaoNota;
  validada: NotaValidada;
  limiteConfiancaItem: number;
  limiteSimilaridade: number;
}

export interface CompraGravada {
  compraId: string;
  status: "extraido" | "revisao";
  /** Itens abaixo do limite de confiança: cada um pede uma pergunta ao dono. */
  itensEmRevisao: Array<{ id: string; ordem: number }>;
  /** Perguntas ao dono criadas: uma por item duvidoso e uma por item sem produto ligado. */
  perguntasCriadas: number;
  /** Verdadeiro quando um job repetido encontrou a compra já gravada. */
  jaExistia: boolean;
}

/**
 * Grava o resultado de uma extração numa transação só: fornecedor, compra, itens e o estado do
 * documento. Idempotente por documento (uma compra por documento), então uma nova tentativa do job
 * não duplica nada. Toda consulta filtra por `comerciante_id` (regra inviolável 3).
 *
 * Cada item tenta ligar a um produto (issue #27). Ligado, entra uma linha em `historico_custo` com a
 * menor entre a confiança do item e a do vínculo. Sem vínculo certo, `produto_id` fica nulo e o dono
 * é perguntado. Item abaixo do limite de confiança também gera pergunta (issue #26).
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
        perguntasCriadas: 0,
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

    let perguntasCriadas = 0;
    for (const linha of itens) {
      const item = extracao.itens[linha.ordem - 1];
      if (!item) throw new Error(`Item ${linha.ordem} sem correspondente na extração`);
      const base = {
        descricao: item.descricao,
        data: extracao.data_emissao,
        fornecedor: extracao.fornecedor.nome,
      };

      const vinculo = await buscarVinculo(tx, {
        comercianteId: e.comercianteId,
        fornecedorId: forn.id,
        descricao: item.descricao,
        limiteSimilaridade: e.limiteSimilaridade,
      });
      if (vinculo.tipo === "vinculado") {
        await tx
          .update(itemDeCompra)
          .set({ produtoId: vinculo.produtoId })
          .where(and(eq(itemDeCompra.id, linha.id), eq(itemDeCompra.comercianteId, e.comercianteId)));
        await tx.insert(historicoCusto).values({
          comercianteId: e.comercianteId,
          produtoId: vinculo.produtoId,
          fornecedorId: forn.id,
          data: extracao.data_emissao,
          custoUnitarioCentavos: item.valor_unitario_centavos,
          itemDeCompraId: linha.id,
          origem: "foto_nota",
          confianca: Math.min(item.confianca, vinculo.confianca),
        });
        if (vinculo.metodo === "similaridade") {
          await registrarVinculo(tx, {
            comercianteId: e.comercianteId,
            fornecedorId: forn.id,
            descricao: item.descricao,
            produtoId: vinculo.produtoId,
            metodo: "similaridade",
            confianca: vinculo.confianca,
            confirmadoPeloDono: false,
          });
        }
      } else {
        const candidatos = vinculo.tipo === "sugestao" ? vinculo.candidatos : [];
        await tx.insert(perguntaDono).values({
          comercianteId: e.comercianteId,
          tipo: "confirmar_vinculo",
          pergunta: montarPerguntaVinculo({ ...base, sugestoes: candidatos.map((c) => c.nome) }),
          contexto: {
            ordem: linha.ordem,
            candidatos: candidatos.map((c) => ({
              produto_id: c.produtoId,
              nome: c.nome,
              similaridade: c.similaridade,
            })),
          },
          itemDeCompraId: linha.id,
        });
        perguntasCriadas++;
      }

      if (linha.revisao) {
        await tx.insert(perguntaDono).values({
          comercianteId: e.comercianteId,
          tipo: "confirmar_item",
          pergunta: montarPerguntaItem({ ...base, valorUnitarioCentavos: item.valor_unitario_centavos }),
          contexto: { ordem: linha.ordem, confianca: item.confianca },
          itemDeCompraId: linha.id,
        });
        perguntasCriadas++;
      }
    }

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

    return { compraId: novaCompra.id, status, itensEmRevisao, perguntasCriadas, jaExistia: false };
  });
}
