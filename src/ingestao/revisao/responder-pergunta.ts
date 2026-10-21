import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../../infra/database/database.module";
import {
  compra,
  documento,
  fornecedor,
  historicoCusto,
  itemDeCompra,
  perguntaDono,
  produto,
} from "../../infra/database/schema";
import { centavos, multiplicar, somar } from "../../lib/dinheiro/dinheiro";
import { extracaoNotaSchema } from "../extracao/esquema-extracao";
import { normalizarDescricao } from "../normalizar-descricao";
import type { MotivoValidacao } from "../validacao/validar-nota";
import { registrarVinculo } from "../vinculo/vincular-produto";
import { montarPerguntaDocumento } from "./perguntas";
import { MOTIVOS_DO_DOCUMENTO, recalcularDocumento } from "./recalcular-documento";
import { reemitirCustos } from "./custos-do-documento";

export type CodigoErroPergunta =
  "nao_encontrada" | "ja_respondida" | "tipo_nao_suportado" | "resposta_invalida" | "produto_invalido";

export class ErroPergunta extends Error {
  constructor(
    readonly codigo: CodigoErroPergunta,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

/** Casas decimais de `item_de_compra.quantidade` (`numeric(14,3)`): mais que isso o banco arredonda. */
const PASSO_QUANTIDADE = 0.001;

/** Resposta a "o valor unitário é este?": o valor certo, e a quantidade se também estava errada. */
export const respostaItemSchema = z
  .object({
    valor_unitario_centavos: z.number().int().nonnegative(),
    quantidade: z.number().positive().multipleOf(PASSO_QUANTIDADE).optional(),
  })
  .strict();

/** Resposta a "qual produto é este item?": um produto do cadastro do próprio comerciante. */
export const respostaVinculoSchema = z.object({ produto_id: z.uuid() }).strict();

/** Resposta a "os dados da nota estão certos?": o dono só confirma; corrigir a nota é reenviá-la. */
export const respostaDocumentoSchema = z.object({ confirmado: z.literal(true) }).strict();

export interface ResultadoResposta {
  perguntaId: string;
  tipo: "confirmar_item" | "informar_custo" | "confirmar_vinculo" | "confirmar_documento";
  /** Status do documento depois da resposta, quando ela mexeu nele. */
  statusDocumento?: "extraido" | "revisao";
  /** Itens que passaram a ter produto ligado por causa desta resposta. */
  itensLigados: number;
}

export interface OpcoesResposta {
  limiteConfiancaItem: number;
}

/**
 * Grava a resposta do dono a uma pergunta pendente (issues #26 e #27), numa transação. O
 * `comerciante_id` vem da sessão. A resposta entra com origem `dono` e confiança 1; o que o modelo
 * leu antes continua no histórico, porque a correção é uma linha nova, nunca uma edição.
 */
export async function responderPergunta(
  db: Db,
  comercianteId: string,
  perguntaId: string,
  corpo: unknown,
  opcoes: OpcoesResposta,
): Promise<ResultadoResposta> {
  return db.transaction(async (tx) => {
    const [pergunta] = await tx
      .select()
      .from(perguntaDono)
      .where(and(eq(perguntaDono.id, perguntaId), eq(perguntaDono.comercianteId, comercianteId)))
      .for("update")
      .limit(1);
    if (!pergunta) throw new ErroPergunta("nao_encontrada", "Pergunta não encontrada");
    if (pergunta.status !== "pendente")
      throw new ErroPergunta("ja_respondida", "Esta pergunta já foi respondida");
    if (
      pergunta.tipo === "confirmar_acao" ||
      (pergunta.tipo !== "confirmar_documento" && !pergunta.itemDeCompraId)
    ) {
      throw new ErroPergunta("tipo_nao_suportado", "Este tipo de pergunta não é respondido por aqui");
    }

    let resultado: Pick<ResultadoResposta, "statusDocumento" | "itensLigados">;
    if (pergunta.tipo === "confirmar_documento") {
      resultado = await responderDocumento(tx, comercianteId, pergunta.contexto, corpo, opcoes);
    } else if (pergunta.tipo === "confirmar_vinculo") {
      resultado = await responderVinculo(
        tx,
        comercianteId,
        pergunta.itemDeCompraId!,
        corpo,
        pergunta.contexto,
      );
    } else {
      resultado = await responderItem(tx, comercianteId, pergunta.itemDeCompraId!, corpo, opcoes);
    }

    await tx
      .update(perguntaDono)
      .set({ status: "respondida", resposta: JSON.stringify(corpo), respondidaEm: new Date() })
      .where(and(eq(perguntaDono.id, perguntaId), eq(perguntaDono.comercianteId, comercianteId)));
    return { perguntaId, tipo: pergunta.tipo, ...resultado };
  });
}

function validar<T>(esquema: z.ZodType<T>, corpo: unknown): T {
  const r = esquema.safeParse(corpo);
  if (!r.success) {
    const erros = r.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
    throw new ErroPergunta("resposta_invalida", erros.join("; "));
  }
  return r.data;
}

async function carregarItem(tx: Tx, comercianteId: string, itemId: string) {
  const [linha] = await tx
    .select({ item: itemDeCompra, compra })
    .from(itemDeCompra)
    .innerJoin(
      compra,
      and(eq(compra.id, itemDeCompra.compraId), eq(compra.comercianteId, itemDeCompra.comercianteId)),
    )
    .where(and(eq(itemDeCompra.id, itemId), eq(itemDeCompra.comercianteId, comercianteId)))
    .limit(1);
  if (!linha) throw new ErroPergunta("nao_encontrada", "Item da pergunta não encontrado");
  return linha;
}

async function responderItem(
  tx: Tx,
  comercianteId: string,
  itemId: string,
  corpo: unknown,
  opcoes: OpcoesResposta,
): Promise<Pick<ResultadoResposta, "statusDocumento" | "itensLigados">> {
  const resposta = validar(respostaItemSchema, corpo);
  const { item, compra: c } = await carregarItem(tx, comercianteId, itemId);

  const quantidade = resposta.quantidade ?? item.quantidade;
  const unitario = centavos(resposta.valor_unitario_centavos);
  await tx
    .update(itemDeCompra)
    .set({
      quantidade,
      valorUnitarioCentavos: unitario,
      valorTotalCentavos: multiplicar(unitario, quantidade),
      confianca: 1,
      origem: "dono",
      revisaoPendente: false,
    })
    .where(and(eq(itemDeCompra.id, itemId), eq(itemDeCompra.comercianteId, comercianteId)));

  // O custo entra no histórico por `atualizarDocumento`, que reemite as linhas dos itens com produto
  // (sem produto, a linha nasce quando o dono confirmar o vínculo, já com este valor).
  const recalculado = await atualizarDocumento(tx, comercianteId, c, item.ordem, opcoes);
  return { statusDocumento: recalculado.status, itensLigados: 0 };
}

/**
 * Recalcula soma, motivos, confiança e status da nota depois de uma resposta do dono e reemite os
 * custos ligados com a confiança nova do documento. `motivosNovos` entram na lista antes da conta
 * (a confirmação do documento usa isso).
 */
async function atualizarDocumento(
  tx: Tx,
  comercianteId: string,
  c: typeof compra.$inferSelect,
  ordemCorrigida: number,
  opcoes: OpcoesResposta,
  motivosNovos: MotivoValidacao[] = [],
) {
  const itens = await tx
    .select({
      valorTotal: itemDeCompra.valorTotalCentavos,
      pendente: itemDeCompra.revisaoPendente,
      confianca: itemDeCompra.confianca,
    })
    .from(itemDeCompra)
    .where(and(eq(itemDeCompra.comercianteId, comercianteId), eq(itemDeCompra.compraId, c.id)));
  const somaItens = somar(...itens.map((i) => centavos(i.valorTotal)));

  const [doc] = c.documentoId
    ? await tx
        .select()
        .from(documento)
        .where(and(eq(documento.id, c.documentoId), eq(documento.comercianteId, comercianteId)))
        .limit(1)
    : [];
  const original = extracaoNotaSchema.pick({ confianca_documento: true }).safeParse(doc?.extracaoJson);
  const recalculado = recalcularDocumento({
    motivos: [...((doc?.motivosValidacao as MotivoValidacao[] | undefined) ?? []), ...motivosNovos],
    ordemCorrigida,
    somaItensCentavos: somaItens,
    totalCentavos: c.totalCentavos,
    confiancaOriginal: original.success
      ? original.data.confianca_documento
      : (doc?.confiancaMedia ?? c.confianca),
    itensAindaEmRevisao: itens.filter((i) => i.pendente).length,
    menorConfiancaItem: Math.min(...itens.map((i) => i.confianca)),
    limiteConfiancaItem: opcoes.limiteConfiancaItem,
  });

  await tx
    .update(compra)
    .set({ somaItensCentavos: somaItens, confianca: recalculado.confiancaDocumento })
    .where(and(eq(compra.id, c.id), eq(compra.comercianteId, comercianteId)));
  if (doc) {
    await tx
      .update(documento)
      .set({
        statusExtracao: recalculado.status,
        confiancaMedia: recalculado.confiancaDocumento,
        motivosValidacao: recalculado.motivos,
      })
      .where(and(eq(documento.id, doc.id), eq(documento.comercianteId, comercianteId)));
  }
  await reemitirCustos(tx, comercianteId, c.id, recalculado.confiancaDocumento);
  if (doc && recalculado.status === "revisao" && !itens.some((i) => i.pendente)) {
    await garantirPerguntaDocumento(tx, comercianteId, c, doc.id, recalculado.motivos);
  }
  return recalculado;
}

/**
 * Corrigir um item pode criar uma divergência de nota (a soma deixa de fechar). Com os itens todos
 * respondidos e a nota ainda em revisão, a única saída é o dono confirmar a nota: pergunta uma vez.
 */
async function garantirPerguntaDocumento(
  tx: Tx,
  comercianteId: string,
  c: typeof compra.$inferSelect,
  documentoId: string,
  motivos: MotivoValidacao[],
): Promise<void> {
  const [aberta] = await tx
    .select({ id: perguntaDono.id })
    .from(perguntaDono)
    .where(
      and(
        eq(perguntaDono.comercianteId, comercianteId),
        eq(perguntaDono.tipo, "confirmar_documento"),
        eq(perguntaDono.status, "pendente"),
        sql`${perguntaDono.contexto}->>'documento_id' = ${documentoId}`,
      ),
    )
    .limit(1);
  if (aberta) return;
  const [forn] = await tx
    .select({ nome: fornecedor.nome })
    .from(fornecedor)
    .where(and(eq(fornecedor.id, c.fornecedorId), eq(fornecedor.comercianteId, comercianteId)))
    .limit(1);
  await tx.insert(perguntaDono).values({
    comercianteId,
    tipo: "confirmar_documento",
    pergunta: montarPerguntaDocumento({
      data: c.data,
      fornecedor: forn?.nome ?? "fornecedor não identificado",
      motivos: motivos.filter((m) => MOTIVOS_DO_DOCUMENTO.includes(m.codigo)).map((m) => m.mensagem),
    }),
    contexto: { documento_id: documentoId, confianca: c.confianca },
  });
}

async function responderDocumento(
  tx: Tx,
  comercianteId: string,
  contexto: unknown,
  corpo: unknown,
  opcoes: OpcoesResposta,
): Promise<Pick<ResultadoResposta, "statusDocumento" | "itensLigados">> {
  validar(respostaDocumentoSchema, corpo);
  const documentoId = z.object({ documento_id: z.uuid() }).safeParse(contexto);
  if (!documentoId.success) throw new ErroPergunta("nao_encontrada", "Documento da pergunta não encontrado");
  const [c] = await tx
    .select()
    .from(compra)
    .where(
      and(eq(compra.documentoId, documentoId.data.documento_id), eq(compra.comercianteId, comercianteId)),
    )
    .limit(1);
  if (!c) throw new ErroPergunta("nao_encontrada", "Compra do documento não encontrada");

  // Ordem 0: nenhum item foi corrigido, só a nota confirmada. O motivo marca a confirmação, e
  // `recalcularDocumento` passa a não reduzir a confiança pelos motivos do documento.
  const recalculado = await atualizarDocumento(tx, comercianteId, c, 0, opcoes, [
    { codigo: "documento_confirmado", mensagem: "O dono confirmou os dados da nota" },
  ]);
  return { statusDocumento: recalculado.status, itensLigados: 0 };
}

/** Produto que o modelo sugeriu na pergunta, se houve sugestão. */
function sugeridoPeloModelo(contexto: unknown): string | null {
  const sugestao = (contexto as { sugestao_modelo?: { produto_id?: unknown } } | null)?.sugestao_modelo;
  return typeof sugestao?.produto_id === "string" ? sugestao.produto_id : null;
}

async function responderVinculo(
  tx: Tx,
  comercianteId: string,
  itemId: string,
  corpo: unknown,
  contextoPergunta: unknown,
): Promise<Pick<ResultadoResposta, "itensLigados">> {
  const resposta = validar(respostaVinculoSchema, corpo);
  const [prod] = await tx
    .select({ id: produto.id })
    .from(produto)
    .where(and(eq(produto.id, resposta.produto_id), eq(produto.comercianteId, comercianteId)))
    .limit(1);
  if (!prod) throw new ErroPergunta("produto_invalido", "Produto não encontrado no seu cadastro");

  const { item, compra: c } = await carregarItem(tx, comercianteId, itemId);
  await registrarVinculo(tx, {
    comercianteId,
    fornecedorId: c.fornecedorId,
    descricao: item.descricaoNota,
    produtoId: prod.id,
    // Confirmar o que o modelo sugeriu fica registrado como tal; a confirmação é sempre do dono.
    metodo: sugeridoPeloModelo(contextoPergunta) === prod.id ? "modelo" : "dono",
    confianca: 1,
    confirmadoPeloDono: true,
  });

  // Vínculo confirmado não se pergunta de novo: liga também os outros itens do mesmo fornecedor
  // com a mesma descrição que ainda estão sem produto, e dispensa as perguntas deles.
  const chave = normalizarDescricao(item.descricaoNota);
  const candidatos = await tx
    .select({ item: itemDeCompra, compra })
    .from(itemDeCompra)
    .innerJoin(
      compra,
      and(eq(compra.id, itemDeCompra.compraId), eq(compra.comercianteId, itemDeCompra.comercianteId)),
    )
    .where(
      and(
        eq(itemDeCompra.comercianteId, comercianteId),
        isNull(itemDeCompra.produtoId),
        eq(compra.fornecedorId, c.fornecedorId),
      ),
    );
  const ligar = candidatos.filter(
    (l) => l.item.id === itemId || normalizarDescricao(l.item.descricaoNota) === chave,
  );

  for (const l of ligar) {
    await tx
      .update(itemDeCompra)
      .set({ produtoId: prod.id })
      .where(and(eq(itemDeCompra.id, l.item.id), eq(itemDeCompra.comercianteId, comercianteId)));
    await tx.insert(historicoCusto).values({
      comercianteId,
      produtoId: prod.id,
      fornecedorId: l.compra.fornecedorId,
      data: l.compra.data,
      custoUnitarioCentavos: l.item.valorUnitarioCentavos,
      itemDeCompraId: l.item.id,
      origem: l.item.origem,
      // A confiança do documento (já recalculada nas respostas anteriores) também limita o custo.
      confianca: Math.min(l.item.confianca, l.compra.confianca),
    });
  }
  const outros = ligar.map((l) => l.item.id).filter((id) => id !== itemId);
  if (outros.length > 0) {
    await tx
      .update(perguntaDono)
      .set({ status: "cancelada" })
      .where(
        and(
          eq(perguntaDono.comercianteId, comercianteId),
          eq(perguntaDono.tipo, "confirmar_vinculo"),
          eq(perguntaDono.status, "pendente"),
          inArray(perguntaDono.itemDeCompraId, outros),
        ),
      );
  }
  return { itensLigados: ligar.length };
}
