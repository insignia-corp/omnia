import { z } from "zod";
import type { Db } from "../../../infra/database/database.module";
import type { MargemDoProduto } from "../../../metricas/margem-por-produto";
import type { MetricasService } from "../../../metricas/metricas.service";
import {
  dadoAusente,
  ehDadoAusente,
  type DadoAusente,
  type ResultadoMetrica,
} from "../../../metricas/resultado-metrica";
import { definirFerramenta } from "../ferramenta";
import { buscarProdutoPorId, buscarProdutoPorNome } from "./buscar-produto";

/** A margem da métrica, mais o quanto o nome digitado combina com o produto achado (0 a 1). */
export type MargemDoProdutoAchado = ResultadoMetrica<MargemDoProduto> & { confianca_da_busca: number };

/** Dado ausente de um produto que foi achado: leva o id e o nome do cadastro, para perguntar ao dono. */
export type AusenteDoProduto = DadoAusente & { produto_id: string; nome: string };

export interface ProdutoAmbiguo {
  ambiguo: true;
  motivo: string;
  candidatos: Array<{ produto_id: string; nome: string; codigo_barras: string | null }>;
}

/**
 * Margem de um produto (issue #51), achado pelo nome aproximado ou pelo id do candidato que o dono escolheu. Sem escolha clara, devolve os
 * candidatos para o agente perguntar ao dono; sem nenhum, dado ausente. A margem é a da métrica.
 */
export function criarGetProductMargin(metricas: MetricasService, db: Db) {
  return definirFerramenta({
    nome: "get_product_margin",
    descricao:
      "Margem de um produto: preço médio de venda dos últimos 30 dias, custo da compra mais recente, " +
      "margem percentual, meta e se está abaixo da meta, com confiança e origem. Informe produto com o nome " +
      'como o dono disse (só o nome, por exemplo "arroz" ou "café 500g", nunca a pergunta inteira); a busca é ' +
      "aproximada. Sem certeza, devolve ambiguo: true com candidatos (produto_id, nome e codigo_barras, que pode ser nulo) " +
      "e um motivo: com mais de um, pergunte ao dono qual; com um só, confirme com o dono se é esse (sem adivinhar). " +
      "Se houver nomes iguais, cite o código de barras para o dono distinguir. Depois que o dono escolher, chame de novo " +
      "com o produto_id do candidato escolhido no lugar de produto (informe só um dos dois); nunca escolha pelo dono. Pode vir como dado ausente " +
      "(ausente: true) sem venda na janela, sem custo ou produto não encontrado: diga isso ao dono. " +
      "Confira o campo nome do resultado: a busca é aproximada, então cite o produto que foi de fato achado. " +
      "menor_confianca já considera quanto o nome combina com o produto (confianca_da_busca): se for baixa, confirme com o dono. " +
      "Quando o produto foi achado mas falta dado (ausente: true), o resultado traz produto_id e nome: use esse produto_id em ask_owner.",
    entrada: z
      .strictObject({
        produto: z.string().trim().min(2).max(120).optional().describe("Nome do produto, como o dono falou."),
        produto_id: z
          .uuid()
          .optional()
          .describe("Id do candidato que o dono escolheu, como veio em candidatos."),
      })
      .refine((e) => (e.produto === undefined) !== (e.produto_id === undefined), {
        message: "Informe produto (o nome) ou produto_id (o candidato escolhido), só um dos dois.",
      }),
    efeito: "nenhum",
    async executar(
      contexto,
      entrada,
    ): Promise<MargemDoProdutoAchado | AusenteDoProduto | DadoAusente | ProdutoAmbiguo> {
      // O id escolhido só vale se for do comerciante da sessão: de outro, cai em produto_nao_encontrado.
      const achado =
        entrada.produto_id !== undefined
          ? await buscarProdutoPorId(db, contexto.comercianteId, entrada.produto_id)
          : await buscarProdutoPorNome(db, contexto.comercianteId, entrada.produto ?? "");
      if (achado.tipo === "vinculado") {
        const margem = await metricas.margemDoProduto(contexto, achado.produtoId);
        // O agente precisa do id validado (do comerciante da sessão) para chamar ask_owner no custo ausente.
        if (ehDadoAusente(margem)) return { ...margem, produto_id: achado.produtoId, nome: achado.nome };
        // A busca por nome aproximado é um dado a mais: um achado fraco rebaixa a confiança do resultado (regra 4).
        const menorConfianca =
          margem.menor_confianca === null
            ? achado.confianca
            : Math.min(margem.menor_confianca, achado.confianca);
        return { ...margem, menor_confianca: menorConfianca, confianca_da_busca: achado.confianca };
      }
      if (achado.tipo === "sugestao") {
        return {
          ambiguo: true,
          motivo:
            achado.candidatos.length === 1
              ? "Não tenho certeza de que é esse produto. Confirme com o dono antes de usar."
              : "Mais de um produto combina com esse nome. Pergunte ao dono qual deles.",
          candidatos: achado.candidatos.map((c) => ({
            produto_id: c.produtoId,
            nome: c.nome,
            codigo_barras: c.codigoBarras,
          })),
        };
      }
      return dadoAusente(
        "produto_nao_encontrado",
        "Não encontrei esse produto no seu cadastro.",
        "Qual é o nome do produto, como aparece na nota ou na prateleira?",
      );
    },
  });
}
