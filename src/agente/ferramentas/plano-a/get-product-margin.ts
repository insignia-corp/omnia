import { z } from "zod";
import type { Db } from "../../../infra/database/database.module";
import type { MargemDoProduto } from "../../../metricas/margem-por-produto";
import type { MetricasService } from "../../../metricas/metricas.service";
import { produtoNaoEncontrado } from "../../../metricas/produto-nao-encontrado";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import { definirFerramenta } from "../ferramenta";
import { buscarProdutoPorId, buscarProdutoPorNome, type ProdutoAchado } from "./buscar-produto";

/** A margem da métrica, mais o quanto o nome digitado combina com o produto achado (0 a 1). */
export type MargemDoProdutoAchado = ResultadoMetrica<MargemDoProduto> & { confianca_da_busca: number };

/** Dado ausente de um produto que foi achado: leva o id e o nome do cadastro, para perguntar ao dono. */
export type AusenteDoProduto = DadoAusente & { produto_id: string; nome: string };

export interface ProdutoAmbiguo {
  ambiguo: true;
  motivo: string;
  candidatos: Array<{
    produto_id: string;
    nome: string;
    codigo_barras: string | null;
    sku: string | null;
    cadastrado_em: string;
    /** Descrição de nota que o dono já confirmou para o produto, quando foi ela que casou. */
    descricao_de_nota: string | null;
  }>;
}

/**
 * Margem de um produto (issue #51), achado pelo nome aproximado. Sem escolha clara, devolve os
 * candidatos para o agente perguntar ao dono; sem nenhum, dado ausente. A margem é a da métrica.
 */
export function criarGetProductMargin(metricas: MetricasService, db: Db) {
  return definirFerramenta({
    nome: "get_product_margin",
    descricao:
      "Margem de um produto: preço médio de venda dos últimos 30 dias, custo da compra mais recente, " +
      "margem percentual, meta e se está abaixo da meta, com confiança e origem. Informe o nome do " +
      'produto como o dono disse (só o nome, por exemplo "arroz" ou "café 500g", nunca a pergunta inteira); a busca é ' +
      "aproximada. Sem certeza, devolve ambiguo: true com candidatos e um motivo: com mais de um, pergunte ao dono " +
      "qual; com um só, confirme com o dono se é esse (sem adivinhar). Pode vir como dado ausente " +
      "(ausente: true) sem venda na janela, sem custo ou produto não encontrado: diga isso ao dono. " +
      "Confira o campo nome do resultado: a busca é aproximada, então cite o produto que foi de fato achado. " +
      "menor_confianca já considera quanto o nome combina com o produto (confianca_da_busca): se for baixa, confirme com o dono. " +
      "Quando o produto foi achado mas falta dado (ausente: true), o resultado traz produto_id e nome: use esse produto_id em ask_owner. " +
      "Cada candidato traz codigo_barras, sku e cadastrado_em (e a descricao_de_nota que casou, se foi ela): use isso para o dono " +
      "distinguir produtos de mesmo nome. Depois que o dono escolher, chame de novo com produto_id (o do candidato escolhido) " +
      "no lugar de produto.",
    entrada: z
      .strictObject({
        produto: z.string().trim().min(2).max(120).optional().describe("Nome do produto, como o dono falou."),
        produto_id: z
          .uuid()
          .optional()
          .describe("Só depois de o dono escolher entre candidatos: o produto_id do candidato escolhido."),
      })
      .refine((e) => (e.produto === undefined) !== (e.produto_id === undefined), {
        message: "Informe produto ou produto_id, um dos dois",
      }),
    efeito: "nenhum",
    async executar(
      contexto,
      { produto, produto_id },
    ): Promise<MargemDoProdutoAchado | AusenteDoProduto | DadoAusente | ProdutoAmbiguo> {
      const achado =
        produto_id === undefined
          ? await buscarProdutoPorNome(db, contexto.comercianteId, produto ?? "")
          : await escolhidoPeloDono(db, contexto.comercianteId, produto_id);
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
            sku: c.sku,
            cadastrado_em: c.cadastradoEm,
            descricao_de_nota: c.descricaoDeNota,
          })),
        };
      }
      return produtoNaoEncontrado("Qual é o nome do produto, como aparece na nota ou na prateleira?");
    },
  });
}

/** O dono escolheu entre candidatos: vale o id só se for de um produto dele, e com confiança total. */
async function escolhidoPeloDono(db: Db, comercianteId: string, produtoId: string): Promise<ProdutoAchado> {
  const produto = await buscarProdutoPorId(db, comercianteId, produtoId);
  return produto ? { tipo: "vinculado", ...produto, confianca: 1 } : { tipo: "sem_candidato" };
}
