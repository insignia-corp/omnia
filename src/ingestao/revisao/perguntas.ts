import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";

interface ContextoNota {
  /** Descrição como impressa na nota. */
  descricao: string;
  /** Data de emissão (AAAA-MM-DD). */
  data: string;
  fornecedor: string;
}

/**
 * Texto da pergunta por item de baixa confiança. Montado pelo código a partir de um modelo fixo:
 * não gasta chamada de modelo e o texto da nota nunca volta a passar por um LLM (regra inviolável 6).
 */
export function montarPerguntaItem(c: ContextoNota & { valorUnitarioCentavos: number }): string {
  return (
    `Não consegui ler bem o item "${c.descricao}" da nota de ${c.data} (${c.fornecedor}). ` +
    `O valor unitário é ${formatarBRL(centavos(c.valorUnitarioCentavos))}?`
  );
}

/** Texto da pergunta quando a descrição da nota não liga com certeza a um produto do cadastro. */
export function montarPerguntaVinculo(
  c: ContextoNota & { sugestoes: string[]; sugestaoPrincipal?: string },
): string {
  const base = `Na nota de ${c.data} (${c.fornecedor}), o item "${c.descricao}" é qual produto do seu cadastro?`;
  const principal = c.sugestaoPrincipal ? ` Parece ser: ${c.sugestaoPrincipal}.` : "";
  if (c.sugestoes.length === 0) return `${base}${principal}`;
  return `${base}${principal} ${c.sugestaoPrincipal ? "Outras opções" : "Pode ser"}: ${c.sugestoes.join("; ")}.`;
}

/**
 * Texto da pergunta quando a dúvida é da nota inteira (CNPJ, data, soma ou leitura geral ruim) e não
 * de um item. Os motivos vêm das conferências em código, nunca do texto da nota.
 */
export function montarPerguntaDocumento(c: Omit<ContextoNota, "descricao"> & { motivos: string[] }): string {
  const motivo = c.motivos.length > 0 ? ` ${c.motivos.join("; ")}.` : " A leitura da foto ficou ruim.";
  return `A nota de ${c.data} (${c.fornecedor}) ficou com dúvida:${motivo} Os dados da nota estão certos?`;
}
