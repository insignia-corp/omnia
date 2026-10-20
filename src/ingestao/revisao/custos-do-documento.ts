import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "../../infra/database/database.module";
import { compra, historicoCusto, itemDeCompra, vinculoDescricaoProduto } from "../../infra/database/schema";
import { normalizarDescricao } from "../normalizar-descricao";

/**
 * Reemite o custo de cada item da compra ligado a produto com a confiança atual do documento (regra
 * inviolável 4: o dado carrega a confiança, e a do documento limita a de cada item dele).
 *
 * O histórico é append-only (regra 10): quando a confiança do documento muda depois da gravação
 * (o dono respondeu um item ou confirmou a nota), entra uma linha nova e vale a mais recente. Não
 * insere nada quando o último registro do item já está igual.
 */
export async function reemitirCustos(
  tx: Tx,
  comercianteId: string,
  compraId: string,
  confiancaDocumento: number,
): Promise<void> {
  const itens = await tx
    .select({ item: itemDeCompra, fornecedorId: compra.fornecedorId, data: compra.data })
    .from(itemDeCompra)
    .innerJoin(
      compra,
      and(eq(compra.id, itemDeCompra.compraId), eq(compra.comercianteId, itemDeCompra.comercianteId)),
    )
    .where(
      and(
        eq(itemDeCompra.comercianteId, comercianteId),
        eq(itemDeCompra.compraId, compraId),
        isNotNull(itemDeCompra.produtoId),
      ),
    );

  for (const { item, fornecedorId, data } of itens) {
    if (!item.produtoId) continue;
    const [vinculo] = await tx
      .select({ confianca: vinculoDescricaoProduto.confianca })
      .from(vinculoDescricaoProduto)
      .where(
        and(
          eq(vinculoDescricaoProduto.comercianteId, comercianteId),
          eq(vinculoDescricaoProduto.descricaoNormalizada, normalizarDescricao(item.descricaoNota)),
          eq(vinculoDescricaoProduto.produtoId, item.produtoId),
        ),
      )
      .orderBy(desc(vinculoDescricaoProduto.criadoEm))
      .limit(1);
    // Valor que o dono confirmou ou corrigiu não depende de quão certo era o vínculo da descrição.
    const doVinculo = item.origem === "dono" ? 1 : (vinculo?.confianca ?? 1);
    const confianca = Math.min(item.confianca, doVinculo, confiancaDocumento);

    const [ultimo] = await tx
      .select({ custo: historicoCusto.custoUnitarioCentavos, confianca: historicoCusto.confianca })
      .from(historicoCusto)
      .where(and(eq(historicoCusto.comercianteId, comercianteId), eq(historicoCusto.itemDeCompraId, item.id)))
      .orderBy(desc(historicoCusto.criadoEm))
      .limit(1);
    // `real` guarda float32: compara com folga, senão cada chamada reinseriria a mesma linha.
    const igual =
      ultimo && ultimo.custo === item.valorUnitarioCentavos && Math.abs(ultimo.confianca - confianca) < 1e-6;
    if (igual) continue;

    await tx.insert(historicoCusto).values({
      comercianteId,
      produtoId: item.produtoId,
      fornecedorId,
      data,
      custoUnitarioCentavos: item.valorUnitarioCentavos,
      itemDeCompraId: item.id,
      origem: item.origem,
      confianca,
    });
  }
}
