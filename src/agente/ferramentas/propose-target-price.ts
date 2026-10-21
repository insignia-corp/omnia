import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../../infra/database/database.module";
import { historicoPrecoMeta, produto } from "../../infra/database/schema";
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { nomeSeguro } from "./ask-owner";
import { definirFerramenta } from "./ferramenta";

/** Teto de sanidade (R$ 100.000,00): um preço-meta acima disso é erro de digitação ou de conta. */
const PRECO_MAXIMO_CENTAVOS = 10_000_000;

/**
 * Propõe o preço-meta de um produto (issue #104). Efeito `escreve_config`: chamar a ferramenta só
 * registra a proposta e devolve a pergunta ao dono; a escrita roda quando o código vê o "sim"
 * (`ConfirmacaoDoDono`). O preço-meta é meta do dono, não preço de venda: não altera venda nem custo,
 * então não há efeito financeiro (regra inviolável 7).
 *
 * Grava o valor vigente em `produto.preco_meta_centavos` e uma linha nova em `historico_preco_meta`
 * (origem `dono`, com o valor anterior): o preço-meta antigo não é apagado (regra inviolável 10).
 */
export function criarProposeTargetPrice(db: Db) {
  const nomeDoProduto = async (comercianteId: string, produtoId: string) => {
    const [p] = await db
      .select({ nome: produto.nome })
      .from(produto)
      .where(and(eq(produto.id, produtoId), eq(produto.comercianteId, comercianteId)))
      .limit(1);
    if (!p) throw new Error("Produto não encontrado no cadastro");
    return nomeSeguro(p.nome);
  };

  return definirFerramenta({
    nome: "propose_target_price",
    descricao:
      "Propõe um preço-meta para um produto. Não grava nada: devolve a pergunta que o dono precisa responder " +
      "com sim; só então o sistema registra. Use o valor que o dono pediu ou que uma ferramenta devolveu, em " +
      "centavos (R$ 12,90 vira 1290). Inclua a pergunta devolvida na sua mensagem e diga que a reação das " +
      "vendas a uma mudança de preço é desconhecida.",
    entrada: z.strictObject({
      produto_id: z.uuid().describe("Id do produto, como devolvido pelas ferramentas de leitura."),
      preco_meta_centavos: z
        .number()
        .int()
        .positive()
        .max(PRECO_MAXIMO_CENTAVOS)
        .describe("Preço-meta em centavos, inteiro."),
    }),
    efeito: "escreve_config",
    async descreverConfirmacao(contexto, entrada) {
      const nome = await nomeDoProduto(contexto.comercianteId, entrada.produto_id);
      const valor = formatarBRL(centavos(entrada.preco_meta_centavos));
      return {
        pergunta: `Quer que eu registre ${valor} como preço-meta de "${nome}"? Responda sim ou não.`,
        resumo: `Pronto, registrei ${valor} como preço-meta de "${nome}".`,
      };
    },
    async executar(contexto, entrada) {
      const { comercianteId } = contexto;
      return (contexto.executor ?? db).transaction(async (tx) => {
        const [atual] = await tx
          .select({ precoMeta: produto.precoMetaCentavos, nome: produto.nome })
          .from(produto)
          .where(and(eq(produto.id, entrada.produto_id), eq(produto.comercianteId, comercianteId)))
          .for("update")
          .limit(1);
        if (!atual) throw new Error("Produto não encontrado no cadastro");
        await tx.insert(historicoPrecoMeta).values({
          comercianteId,
          produtoId: entrada.produto_id,
          precoMetaCentavos: entrada.preco_meta_centavos,
          anteriorCentavos: atual.precoMeta,
          origem: "dono",
          confianca: 1,
        });
        await tx
          .update(produto)
          .set({ precoMetaCentavos: entrada.preco_meta_centavos })
          .where(and(eq(produto.id, entrada.produto_id), eq(produto.comercianteId, comercianteId)));
        return {
          produto_id: entrada.produto_id,
          // O nome pode ter número ("Arroz 5kg"): ele precisa estar na saída para o aviso passar no verificador.
          produto_nome: nomeSeguro(atual.nome),
          preco_meta_centavos: entrada.preco_meta_centavos,
          anterior_centavos: atual.precoMeta,
        };
      });
    },
  });
}
