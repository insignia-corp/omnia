import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { identificadorDoFornecedor } from "../lib/cnpj/cnpj";
import type { Db, Tx } from "../infra/database/database.module";
import {
  compra,
  documento,
  fornecedor,
  historicoCusto,
  itemDeCompra,
  perguntaDono,
  produto,
} from "../infra/database/schema";
import type { ExtracaoNota } from "./extracao/esquema-extracao";
import { montarPerguntaDocumento, montarPerguntaItem, montarPerguntaVinculo } from "./revisao/perguntas";
import { MOTIVOS_DO_DOCUMENTO } from "./revisao/recalcular-documento";
import { dataDeCalendarioValida, type NotaValidada } from "./validacao/validar-nota";
import type { SugestaoModelo } from "./vinculo/sugestor-vinculo";
import { buscarVinculo, registrarVinculo } from "./vinculo/vincular-produto";

export interface EntradaGravacao {
  comercianteId: string;
  documentoId: string;
  /** Saída do modelo como veio, já validada pelo Zod. Fica no documento para auditoria. */
  extracaoOriginal: ExtracaoNota;
  validada: NotaValidada;
  limiteConfiancaItem: number;
  limiteSimilaridade: number;
  /** De onde veio a nota: foto lida pelo modelo ou XML de NF-e lido em código. */
  origem: "foto_nota" | "nfe";
  /** Número impresso na nota, quando a origem o traz (NF-e). */
  numeroDocumento?: string | null;
  /** Código de barras de cada item, na ordem da nota, quando a origem o traz (NF-e). */
  codigosBarras?: ReadonlyArray<string | null>;
  /**
   * Sugestão do modelo por ordem do item (issue #27). Só enriquece a pergunta ao dono: o vínculo
   * continua sendo decidido aqui dentro, e item sem vínculo certo nunca é ligado por sugestão.
   */
  sugestoesModelo?: ReadonlyMap<number, SugestaoModelo>;
}

export interface CompraGravada {
  compraId: string;
  status: "extraido" | "revisao";
  /** Itens abaixo do limite de confiança: cada um pede uma pergunta ao dono. */
  itensEmRevisao: Array<{ id: string; ordem: number }>;
  /** Perguntas ao dono criadas: uma por item duvidoso, uma por item sem produto e uma se a nota toda é duvidosa. */
  perguntasCriadas: number;
  /** Verdadeiro quando um job repetido encontrou a compra já gravada. */
  jaExistia: boolean;
}

/**
 * Acha ou cria o fornecedor da nota. Com CNPJ legível a chave é o CNPJ. Sem ele (ilegível, "N/A")
 * o CNPJ fica nulo, e não vazio: um identificador vazio compartilhado juntaria fornecedores
 * diferentes. Nesse caso a chave é o nome, só entre fornecedores também sem CNPJ.
 */
async function obterFornecedor(
  tx: Tx,
  e: EntradaGravacao,
  nome: string,
  cnpj: string | null,
  confianca: number,
): Promise<string> {
  const base = { comercianteId: e.comercianteId, nome, origem: e.origem, confianca };
  if (cnpj) {
    await tx
      .insert(fornecedor)
      .values({ ...base, cnpj })
      .onConflictDoNothing({ target: [fornecedor.comercianteId, fornecedor.cnpj] });
  }
  const mesmoFornecedor = cnpj
    ? eq(fornecedor.cnpj, cnpj)
    : and(isNull(fornecedor.cnpj), sql`lower(${fornecedor.nome}) = ${nome.trim().toLowerCase()}`);
  const busca = () =>
    tx
      .select({ id: fornecedor.id })
      .from(fornecedor)
      .where(and(eq(fornecedor.comercianteId, e.comercianteId), mesmoFornecedor))
      .orderBy(asc(fornecedor.criadoEm))
      .limit(1);
  const [existente] = await busca();
  if (existente) return existente.id;
  if (cnpj) throw new Error("Fornecedor não encontrado depois de gravar");
  const [novo] = await tx
    .insert(fornecedor)
    .values({ ...base, cnpj: null })
    .returning({ id: fornecedor.id });
  if (!novo) throw new Error("Falha ao gravar o fornecedor");
  return novo.id;
}

/**
 * Grava o resultado de uma extração numa transação só: fornecedor, compra, itens e o estado do
 * documento. Idempotente por documento (uma compra por documento), então uma nova tentativa do job
 * não duplica nada. Toda consulta filtra por `comerciante_id` (regra inviolável 3).
 *
 * Cada item tenta ligar a um produto (issue #27). Ligado, entra uma linha em `historico_custo` com a
 * menor entre a confiança do item e a do vínculo. Sem vínculo certo, `produto_id` fica nulo e o dono
 * é perguntado. Item abaixo do limite de confiança também gera pergunta (issue #26), e a nota com
 * confiança de documento abaixo do limite gera uma pergunta de documento.
 */
export async function gravarCompra(db: Db, e: EntradaGravacao): Promise<CompraGravada> {
  return db.transaction(async (tx) => {
    const existente = await tx
      .select({ id: compra.id })
      .from(compra)
      .where(and(eq(compra.comercianteId, e.comercianteId), eq(compra.documentoId, e.documentoId)))
      .limit(1);
    const doc = await tx
      .select({ status: documento.statusExtracao, criadoEm: documento.criadoEm })
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

    const fornecedorId = await obterFornecedor(
      tx,
      e,
      extracao.fornecedor.nome,
      identificadorDoFornecedor(extracao.fornecedor.cnpj),
      confiancaDocumento,
    );

    // A coluna `data` é `date`: "2026-02-31" passa no formato, mas o PostgreSQL recusa e a nota
    // se perderia. Data que não existe no calendário cai na data do envio, com o motivo
    // `data_invalida` já no documento e a confiança do histórico limitada à do documento.
    const dataSubstituida = !dataDeCalendarioValida(extracao.data_emissao);
    const dataCompra = dataSubstituida ? doc[0].criadoEm.toISOString().slice(0, 10) : extracao.data_emissao;

    const [novaCompra] = await tx
      .insert(compra)
      .values({
        comercianteId: e.comercianteId,
        documentoId: e.documentoId,
        fornecedorId,
        data: dataCompra,
        totalCentavos: extracao.total_centavos,
        somaItensCentavos: e.validada.somaItensCentavos,
        numeroDocumento: e.numeroDocumento ?? null,
        origem: e.origem,
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
          origem: e.origem,
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
        data: dataCompra,
        fornecedor: extracao.fornecedor.nome,
      };

      const vinculo = await buscarVinculo(tx, {
        comercianteId: e.comercianteId,
        fornecedorId,
        descricao: item.descricao,
        limiteSimilaridade: e.limiteSimilaridade,
        codigoBarras: e.codigosBarras?.[linha.ordem - 1] ?? null,
      });
      if (vinculo.tipo === "vinculado") {
        await tx
          .update(itemDeCompra)
          .set({ produtoId: vinculo.produtoId })
          .where(and(eq(itemDeCompra.id, linha.id), eq(itemDeCompra.comercianteId, e.comercianteId)));
        await tx.insert(historicoCusto).values({
          comercianteId: e.comercianteId,
          produtoId: vinculo.produtoId,
          fornecedorId,
          data: dataCompra,
          custoUnitarioCentavos: item.valor_unitario_centavos,
          itemDeCompraId: linha.id,
          origem: e.origem,
          // A confiança do documento (CNPJ, data e soma conferidos em código) também limita o custo.
          confianca: Math.min(item.confianca, vinculo.confianca, confiancaDocumento),
        });
        if (vinculo.metodo === "similaridade") {
          await registrarVinculo(tx, {
            comercianteId: e.comercianteId,
            fornecedorId,
            descricao: item.descricao,
            produtoId: vinculo.produtoId,
            metodo: "similaridade",
            confianca: vinculo.confianca,
            confirmadoPeloDono: false,
          });
        }
      } else {
        const candidatos = vinculo.tipo === "sugestao" ? vinculo.candidatos : [];
        const sugestaoModelo = e.sugestoesModelo?.get(linha.ordem);
        // O produto sugerido precisa existir no cadastro deste comerciante; senão é descartado.
        const [produtoSugerido] = sugestaoModelo
          ? await tx
              .select({ id: produto.id, nome: produto.nome })
              .from(produto)
              .where(
                and(eq(produto.id, sugestaoModelo.produtoId), eq(produto.comercianteId, e.comercianteId)),
              )
              .limit(1)
          : [];
        const nomes = candidatos.map((c) => c.nome).filter((n) => n !== produtoSugerido?.nome);
        await tx.insert(perguntaDono).values({
          comercianteId: e.comercianteId,
          tipo: "confirmar_vinculo",
          pergunta: montarPerguntaVinculo({
            ...base,
            sugestoes: nomes,
            ...(produtoSugerido ? { sugestaoPrincipal: produtoSugerido.nome } : {}),
          }),
          contexto: {
            ordem: linha.ordem,
            candidatos: candidatos.map((c) => ({
              produto_id: c.produtoId,
              nome: c.nome,
              similaridade: c.similaridade,
            })),
            ...(produtoSugerido && sugestaoModelo
              ? {
                  sugestao_modelo: {
                    produto_id: produtoSugerido.id,
                    nome: produtoSugerido.nome,
                    confianca: sugestaoModelo.confianca,
                  },
                }
              : {}),
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
    const documentoEmDuvida = confiancaDocumento < e.limiteConfiancaItem;
    const motivosDoDocumento = e.validada.motivos.filter((m) => MOTIVOS_DO_DOCUMENTO.includes(m.codigo));
    // Dúvida da nota inteira (CNPJ, data, soma, leitura geral) não cabe em pergunta de item: sem esta
    // pergunta o documento ficaria em revisão sem caminho para o dono resolver. Confiança baixa só
    // por causa de um item ilegível já tem a pergunta do item, que ao ser respondida a recalcula.
    if (motivosDoDocumento.length > 0 || (documentoEmDuvida && itensEmRevisao.length === 0)) {
      await tx.insert(perguntaDono).values({
        comercianteId: e.comercianteId,
        tipo: "confirmar_documento",
        pergunta: montarPerguntaDocumento({
          data: extracao.data_emissao,
          fornecedor: extracao.fornecedor.nome,
          motivos: motivosDoDocumento.map((m) => m.mensagem),
        }),
        contexto: { documento_id: e.documentoId, confianca: confiancaDocumento },
      });
      perguntasCriadas++;
    }

    const status = itensEmRevisao.length > 0 || documentoEmDuvida ? "revisao" : "extraido";
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
