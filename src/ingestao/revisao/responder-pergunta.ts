import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../../infra/database/database.module";
import {
  compra,
  documento,
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
import { recalcularDocumento } from "./recalcular-documento";

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

/** Resposta a "o valor unitário é este?": o valor certo, e a quantidade se também estava errada. */
export const respostaItemSchema = z
  .object({
    valor_unitario_centavos: z.number().int().nonnegative(),
    quantidade: z.number().positive().optional(),
  })
  .strict();

/** Resposta a "qual produto é este item?": um produto do cadastro do próprio comerciante. */
export const respostaVinculoSchema = z.object({ produto_id: z.uuid() }).strict();

export interface ResultadoResposta {
  perguntaId: string;
  tipo: "confirmar_item" | "informar_custo" | "confirmar_vinculo";
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
    if (!pergunta.itemDeCompraId || pergunta.tipo === "confirmar_acao") {
      throw new ErroPergunta("tipo_nao_suportado", "Este tipo de pergunta não é respondido por aqui");
    }

    const resultado =
      pergunta.tipo === "confirmar_vinculo"
        ? await responderVinculo(tx, comercianteId, pergunta.itemDeCompraId, corpo)
        : await responderItem(tx, comercianteId, pergunta.itemDeCompraId, corpo, opcoes);

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

  // Só há custo no histórico para item com produto. Sem produto, a linha nasce quando o dono
  // confirmar o vínculo, já com este valor.
  if (item.produtoId) {
    await tx.insert(historicoCusto).values({
      comercianteId,
      produtoId: item.produtoId,
      fornecedorId: c.fornecedorId,
      data: c.data,
      custoUnitarioCentavos: unitario,
      itemDeCompraId: itemId,
      origem: "dono",
      confianca: 1,
    });
  }

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
    motivos: (doc?.motivosValidacao as MotivoValidacao[] | undefined) ?? [],
    ordemCorrigida: item.ordem,
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
  return { statusDocumento: recalculado.status, itensLigados: 0 };
}

async function responderVinculo(
  tx: Tx,
  comercianteId: string,
  itemId: string,
  corpo: unknown,
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
    metodo: "dono",
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
      confianca: l.item.confianca,
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
