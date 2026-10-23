import { z } from "zod";
import type { MargemDoProduto } from "../../../metricas/margem-por-produto";
import type { MetricasService } from "../../../metricas/metricas.service";
import {
  combinarProcedencias,
  dadoAusente,
  ehDadoAusente,
  procedenciaDe,
  type DadoAusente,
  type ResultadoMetrica,
} from "../../../metricas/resultado-metrica";
import { definirFerramenta } from "../ferramenta";

export interface ListaDeMargens {
  filtro: "abaixo_da_meta" | "todos";
  ordenar: "menor_margem" | "maior_margem";
  /** Quantos produtos atendem ao filtro, sejam quantos forem os listados (responde "quantos estão abaixo da meta"). */
  total_que_atendem: number;
  /** Produtos com margem calculada (os que tiveram venda na janela e custo). */
  total_com_margem: number;
  /** Produtos do cadastro cuja margem não deu para calcular (sem venda na janela ou sem custo). */
  produtos_sem_dado: number;
  /** A meta de margem usada, quando é a mesma para todos os produtos com margem; nulo se variam (cada linha traz a sua). */
  meta_percentual: number | null;
  /** Os primeiros `limite` produtos, na ordem pedida. */
  produtos: MargemDoProduto[];
}

/**
 * Lista de margens dos produtos do comerciante da sessão, da menor para a maior margem (ou o
 * contrário). Usa as margens da métrica (`margensDosProdutos`), as mesmas do painel e do "Sugerir
 * preço"; a ferramenta só filtra, ordena e corta a lista, e diz o total. Existe porque as perguntas
 * de margem sem produto ("qual tem a menor margem", "quantos estão abaixo da meta") não cabem em
 * `get_product_margin`, que exige um nome.
 */
export function criarListProductMargins(metricas: MetricasService) {
  return definirFerramenta({
    nome: "list_product_margins",
    descricao:
      "Lista os produtos pela margem de lucro percentual (preço médio de venda dos últimos 30 dias contra o custo da compra mais recente), " +
      "sem precisar do nome. Use quando o dono perguntar qual produto tem a menor ou a maior margem, " +
      "qual dá mais ou menos lucro (margem é percentual sobre o preço, não o lucro total em reais), quais ou quantos produtos estão abaixo da meta de margem. " +
      "Para um produto que o dono nomeou, use get_product_margin. filtro 'abaixo_da_meta' lista só os abaixo da meta; 'todos' lista todos. " +
      "ordenar 'menor_margem' começa pelos piores; 'maior_margem' pelos melhores. limite é quantos listar (1 a 10, padrão 5). " +
      "O resultado traz total_que_atendem (quantos produtos atendem ao filtro, mesmo os não listados: é o número para 'quantos estão abaixo da meta'), " +
      "total_com_margem, produtos_sem_dado (margem que não deu para calcular: diga isso ao dono se for relevante), " +
      "meta_percentual (a meta usada, nula se varia por produto) e, em cada produto, margem_percentual, meta_percentual, abaixo_da_meta, " +
      "preço médio de venda, custo, e preco_para_meta_centavos (o preço que leva a margem à meta). " +
      "Pode vir como dado ausente (ausente: true) sem meta de margem ou sem produto com venda e custo: diga isso ao dono.",
    entrada: z.strictObject({
      filtro: z
        .enum(["abaixo_da_meta", "todos"])
        .default("todos")
        .describe("abaixo_da_meta: só os produtos com margem abaixo da meta. todos: sem filtro."),
      ordenar: z
        .enum(["menor_margem", "maior_margem"])
        .default("menor_margem")
        .describe("menor_margem: os piores primeiro. maior_margem: os melhores primeiro."),
      limite: z.number().int().min(1).max(10).default(5).describe("Quantos produtos listar, de 1 a 10."),
    }),
    efeito: "nenhum",
    async executar(
      contexto,
      { filtro, ordenar, limite },
    ): Promise<ResultadoMetrica<ListaDeMargens> | DadoAusente> {
      const todas = await metricas.margensDosProdutos(contexto);
      if (todas.length === 0) {
        return dadoAusente(
          "sem_meta_de_margem",
          "Sem meta de margem do comerciante ou sem produtos cadastrados.",
          "Qual margem de lucro você quer em cada produto?",
        );
      }
      const calculadas = todas.flatMap((m) => (ehDadoAusente(m.resultado) ? [] : [m.resultado]));
      if (calculadas.length === 0) {
        return dadoAusente(
          "sem_margem_calculavel",
          "Nenhum produto tem venda nos últimos 30 dias e custo de compra para calcular a margem.",
        );
      }
      const valores = calculadas.map((r) => r.valor);
      const atendem = filtro === "abaixo_da_meta" ? valores.filter((v) => v.abaixo_da_meta) : valores;
      // Desempate por nome e id: a mesma pergunta devolve sempre a mesma lista.
      const sentido = ordenar === "menor_margem" ? 1 : -1;
      const ordenados = [...atendem].sort(
        (a, b) =>
          sentido * (a.margem_bps - b.margem_bps) ||
          a.nome.localeCompare(b.nome, "pt-BR") ||
          (a.produto_id < b.produto_id ? -1 : 1),
      );
      const metas = new Set(valores.map((v) => v.meta_bps));
      const [primeiro] = calculadas;
      return {
        valor: {
          filtro,
          ordenar,
          total_que_atendem: atendem.length,
          total_com_margem: valores.length,
          produtos_sem_dado: todas.length - calculadas.length,
          meta_percentual: metas.size === 1 ? valores[0]!.meta_percentual : null,
          produtos: ordenados.slice(0, limite),
        },
        periodo: primeiro!.periodo,
        ...combinarProcedencias(calculadas.map(procedenciaDe)),
      };
    },
  });
}
