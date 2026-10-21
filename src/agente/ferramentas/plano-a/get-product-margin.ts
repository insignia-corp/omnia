import { z } from "zod";
import type { Db } from "../../../infra/database/database.module";
import type { MargemDoProduto } from "../../../metricas/margem-por-produto";
import type { MetricasService } from "../../../metricas/metricas.service";
import { dadoAusente, type DadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import { definirFerramenta } from "../ferramenta";
import { buscarProdutoPorNome } from "./buscar-produto";

export interface ProdutoAmbiguo {
  ambiguo: true;
  motivo: string;
  candidatos: Array<{ produto_id: string; nome: string }>;
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
      "produto como o dono disse; a busca é aproximada. Se mais de um produto couber, devolve " +
      "ambiguo: true com candidatos (pergunte ao dono qual, sem adivinhar). Pode vir como dado ausente " +
      "(ausente: true) sem venda na janela, sem custo ou produto não encontrado: diga isso ao dono. " +
      "Confira o campo nome do resultado: a busca é aproximada, então cite o produto que foi de fato achado. " +
      "O produto_id do resultado serve para ask_owner.",
    entrada: z.strictObject({
      produto: z.string().trim().min(2).max(120).describe("Nome do produto, como o dono falou."),
    }),
    efeito: "nenhum",
    async executar(
      contexto,
      { produto },
    ): Promise<ResultadoMetrica<MargemDoProduto> | DadoAusente | ProdutoAmbiguo> {
      const achado = await buscarProdutoPorNome(db, contexto.comercianteId, produto);
      if (achado.tipo === "vinculado") return metricas.margemDoProduto(contexto, achado.produtoId);
      if (achado.tipo === "sugestao") {
        return {
          ambiguo: true,
          motivo: "Mais de um produto combina com esse nome. Pergunte ao dono qual deles.",
          candidatos: achado.candidatos.map((c) => ({ produto_id: c.produtoId, nome: c.nome })),
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
