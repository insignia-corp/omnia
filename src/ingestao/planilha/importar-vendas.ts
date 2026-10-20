import { centavos, somar } from "../../lib/dinheiro/dinheiro";
import type { Db } from "../../infra/database/database.module";
import { itemDeVenda, venda } from "../../infra/database/schema";
import type { ItemInterpretado } from "./interpretar-linhas";

export interface ResultadoGravacaoVendas {
  vendasNovas: number;
  /** Cupons que já estavam no banco para aquela data: reimportar não duplica nem altera. */
  vendasExistentes: number;
  itensNovos: number;
}

const LOTE_VENDAS = 500;
const LOTE_ITENS = 2000;

interface VendaAgrupada {
  data: string;
  cupom: string;
  hora: string | null;
  itens: ItemInterpretado[];
}

/**
 * Grava as vendas de uma planilha numa transação só. A venda é única por `(comerciante, data,
 * cupom)`: reimportar o mesmo arquivo, ou outro que repita cupons, não duplica nada. Todo dado
 * entra com origem `planilha` e confiança 1 (é o que o PDV registrou) e `comerciante_id` da sessão.
 */
export async function gravarVendas(
  db: Db,
  entrada: { comercianteId: string; documentoId: string; itens: readonly ItemInterpretado[] },
): Promise<ResultadoGravacaoVendas> {
  const grupos = new Map<string, VendaAgrupada>();
  for (const item of entrada.itens) {
    const chave = `${item.data}|${item.cupom}`;
    const grupo = grupos.get(chave) ?? { data: item.data, cupom: item.cupom, hora: item.hora, itens: [] };
    grupo.itens.push(item);
    grupos.set(chave, grupo);
  }
  const vendas = [...grupos.values()];

  return db.transaction(async (tx) => {
    let vendasNovas = 0;
    let itensNovos = 0;
    for (let i = 0; i < vendas.length; i += LOTE_VENDAS) {
      const lote = vendas.slice(i, i + LOTE_VENDAS);
      const inseridas = await tx
        .insert(venda)
        .values(
          lote.map((v) => ({
            comercianteId: entrada.comercianteId,
            documentoId: entrada.documentoId,
            data: v.data,
            hora: v.hora,
            numeroCupom: v.cupom,
            totalCentavos: somar(...v.itens.map((it) => centavos(it.totalCentavos))),
            origem: "planilha" as const,
            confianca: 1,
          })),
        )
        .onConflictDoNothing({ target: [venda.comercianteId, venda.data, venda.numeroCupom] })
        .returning({ id: venda.id, data: venda.data, numeroCupom: venda.numeroCupom });
      vendasNovas += inseridas.length;

      const porChave = new Map(inseridas.map((v) => [`${v.data}|${v.numeroCupom}`, v.id]));
      const linhas = lote.flatMap((v) => {
        const vendaId = porChave.get(`${v.data}|${v.cupom}`);
        return vendaId
          ? v.itens.map((it) => ({
              comercianteId: entrada.comercianteId,
              vendaId,
              produtoId: it.produtoId,
              quantidade: it.quantidade,
              precoUnitarioCentavos: it.precoUnitarioCentavos,
              valorTotalCentavos: it.totalCentavos,
            }))
          : [];
      });
      for (let j = 0; j < linhas.length; j += LOTE_ITENS) {
        await tx.insert(itemDeVenda).values(linhas.slice(j, j + LOTE_ITENS));
      }
      itensNovos += linhas.length;
    }
    return { vendasNovas, vendasExistentes: vendas.length - vendasNovas, itensNovos };
  });
}
