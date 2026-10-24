/**
 * Mensagem de "nota lida" (issue #182), montada pelo código a partir da compra gravada: os números
 * são os que a ingestão conferiu em código (somas, quantidade x unitário) e a comparação do custo com a
 * compra anterior do produto, formatados sem modelo
 * (regra inviolável 1). O texto da nota entra só como descrição de item, nunca como instrução (regra 6).
 */
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { razaoEmBps } from "../../metricas/pontos-base";

/** Item ligado a um produto cujo custo mudou contra a compra anterior (qualquer fornecedor). */
export interface AvisoDeCusto {
  produto: string;
  anteriorCentavos: number;
  atualCentavos: number;
  /** Variação em pontos-base inteiros: positiva na alta, negativa na queda. */
  variacaoBps: number;
}

/**
 * Compara o custo unitário da nota com o da compra anterior do mesmo produto, em centavos inteiros.
 * Custo igual, ou anterior zero (sem base de comparação), não gera aviso.
 */
export function avisoDeCusto(
  produto: string,
  anteriorCentavos: number,
  atualCentavos: number,
): AvisoDeCusto | null {
  if (anteriorCentavos === atualCentavos) return null;
  const variacaoBps = razaoEmBps(atualCentavos - anteriorCentavos, anteriorCentavos);
  if (variacaoBps === null) return null;
  return { produto, anteriorCentavos, atualCentavos, variacaoBps };
}

export interface NotaParaMensagem {
  fornecedor: string;
  /** Data da compra (AAAA-MM-DD). */
  data: string;
  totalCentavos: number;
  somaItensCentavos: number;
  itens: {
    descricao: string;
    quantidade: string;
    valorUnitarioCentavos: number;
    valorTotalCentavos: number;
  }[];
  /** Itens com custo diferente da compra anterior do produto; vazio quando tudo igual ou sem compra anterior. */
  avisosDeCusto: AvisoDeCusto[];
  /** A nota ficou em revisão (item duvidoso ou dúvida da nota inteira). */
  emRevisao: boolean;
  /** Quantas perguntas sobre esta nota esperam o dono. */
  perguntasPendentes: number;
  /** A mesma nota já tinha chegado antes: a leitura mostrada é a que já estava guardada. */
  repetida: boolean;
}

/** Perguntas da nota mandadas logo depois da leitura; as outras ficam pendentes, sem inundar a conversa. */
export const MAX_PERGUNTAS_NA_CONVERSA = 3;

const reais = (c: number) => formatarBRL(centavos(c));
/** "2026-10-16" vira "16/10". */
export const diaMes = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

/** Pontos-base como texto para o dono, só com inteiros: 1065 vira "10,65". */
export function percentualDeBpsTexto(bps: number): string {
  const absoluto = Math.abs(bps);
  return `${Math.floor(absoluto / 100)},${String(absoluto % 100).padStart(2, "0")}`;
}

export function textoNotaLida(n: NotaParaMensagem): string {
  const linhas: string[] = [];
  if (n.repetida) {
    linhas.push(
      `Esta nota já estava no seu histórico, então não contei de novo. É a da ${n.fornecedor}, de ${diaMes(n.data)}.`,
    );
    linhas.push("");
  }
  // Blocos separados por linha em branco, como no WhatsApp: quem e quanto, depois o que mudou.
  linhas.push(`🧾 *${n.fornecedor}*`);
  linhas.push(
    `${n.itens.length} ${n.itens.length === 1 ? "item" : "itens"}, total *${reais(n.totalCentavos)}*`,
  );
  linhas.push("");
  if (n.avisosDeCusto.length === 0) {
    linhas.push("✅ Tudo certo com os preços.");
  } else {
    linhas.push("⚠️ *Custo diferente da última compra*");
    for (const a of n.avisosDeCusto) {
      linhas.push(
        `• *${a.produto}*: de ${reais(a.anteriorCentavos)} para ${reais(a.atualCentavos)} (${a.variacaoBps > 0 ? "alta" : "queda"} de ${percentualDeBpsTexto(a.variacaoBps)}%)`,
      );
    }
  }
  if (n.somaItensCentavos !== n.totalCentavos) {
    linhas.push("");
    linhas.push(`A soma dos itens dá ${reais(n.somaItensCentavos)}, diferente do total da nota.`);
  }
  if (n.perguntasPendentes > 0) {
    linhas.push("");
    linhas.push(
      n.perguntasPendentes === 1
        ? "Ficou uma dúvida nesta nota. Te pergunto a seguir."
        : n.perguntasPendentes <= MAX_PERGUNTAS_NA_CONVERSA
          ? `Ficaram ${n.perguntasPendentes} dúvidas nesta nota. Te pergunto a seguir.`
          : `Ficaram ${n.perguntasPendentes} dúvidas nesta nota. Te pergunto as ${MAX_PERGUNTAS_NA_CONVERSA} primeiras a seguir; as outras ficam guardadas para depois.`,
    );
  } else if (n.emRevisao) {
    linhas.push("");
    linhas.push("Algum dado desta nota ficou em dúvida; confira antes de confiar nos custos dela.");
  }
  return linhas.join("\n");
}
