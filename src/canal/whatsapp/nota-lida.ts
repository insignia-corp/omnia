/**
 * Mensagem de "nota lida" (issue #182), montada pelo código a partir da compra gravada: os números
 * são os que a ingestão conferiu em código (somas, quantidade x unitário), formatados sem modelo
 * (regra inviolável 1). O texto da nota entra só como descrição de item, nunca como instrução (regra 6).
 */
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";

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
  /** A nota ficou em revisão (item duvidoso ou dúvida da nota inteira). */
  emRevisao: boolean;
  /** Quantas perguntas sobre esta nota esperam o dono. */
  perguntasPendentes: number;
  /** A mesma nota já tinha chegado antes: a leitura mostrada é a que já estava guardada. */
  repetida: boolean;
}

/** Itens listados na mensagem; o resto vira "e mais N itens", para caber no WhatsApp. */
export const MAX_ITENS_NA_MENSAGEM = 12;
/** Perguntas da nota mandadas logo depois da leitura; as outras ficam pendentes, sem inundar a conversa. */
export const MAX_PERGUNTAS_NA_CONVERSA = 3;

const reais = (c: number) => formatarBRL(centavos(c));
/** "2026-10-16" vira "16/10". */
export const diaMes = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

/** "16.000" vira "16"; "1.500" vira "1,5". A quantidade vem do banco como texto (`numeric`). */
export function formatarQuantidade(q: string): string {
  const [inteiro = "0", fracao = ""] = q.split(".");
  const casas = fracao.replace(/0+$/, "");
  return casas ? `${inteiro},${casas}` : inteiro;
}

export function textoNotaLida(n: NotaParaMensagem): string {
  const linhas: string[] = [];
  linhas.push(
    n.repetida
      ? `Esta nota já estava no seu histórico, então não contei de novo. É a da *${n.fornecedor}*, de ${diaMes(n.data)}:`
      : `Li a nota da *${n.fornecedor}*, de ${diaMes(n.data)}:`,
  );
  linhas.push("");
  for (const i of n.itens.slice(0, MAX_ITENS_NA_MENSAGEM)) {
    linhas.push(
      `• ${i.descricao}: ${formatarQuantidade(i.quantidade)} x ${reais(i.valorUnitarioCentavos)} = ${reais(i.valorTotalCentavos)}`,
    );
  }
  const restantes = n.itens.length - MAX_ITENS_NA_MENSAGEM;
  if (restantes > 0) linhas.push(`• e mais ${restantes} ${restantes === 1 ? "item" : "itens"}`);
  linhas.push("");
  linhas.push(
    n.somaItensCentavos === n.totalCentavos
      ? `*Total: ${reais(n.totalCentavos)}* (confere com a soma dos itens)`
      : `*Total: ${reais(n.totalCentavos)}*, mas a soma dos itens dá ${reais(n.somaItensCentavos)}`,
  );
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
