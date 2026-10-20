import { sql } from "drizzle-orm";
import type { ExecucaoRegistrada, ResultadoExecucao } from "../../agente/execucao/registro-execucoes";
import { custoMicrodolares } from "../../agente/llm/modelo-linguagem";
import type { Executor } from "../../infra/database/database.module";
import { normalizarDescricao } from "../normalizar-descricao";
import type { ClienteSugestao } from "./cliente-sugestao";
import { sugestaoModeloSchema } from "./esquema-sugestao";
import type { PromptVinculo } from "./prompt-vinculo";

/** A sugestão do modelo nunca liga sozinha: no máximo vira candidata da pergunta ao dono. */
export const CONFIANCA_MAXIMA_MODELO = 0.7;
/** Até este tamanho de catálogo, vai o catálogo inteiro; acima, só os mais parecidos com cada item. */
export const CATALOGO_COMPLETO_ATE = 200;
const PARECIDOS_POR_ITEM = 30;
const DESCRICAO_MAXIMA = 120;

export interface ItemSemVinculo {
  ordem: number;
  descricao: string;
  unidade: string;
}

export interface SugestaoModelo {
  produtoId: string;
  /** Nome do cadastro, nunca o texto que o modelo devolveu. */
  nome: string;
  confianca: number;
}

export interface ResultadoSugestao {
  /** Por ordem do item na nota. */
  sugestoes: Map<number, SugestaoModelo>;
  /** Registro da chamada ao modelo; nulo quando nem foi preciso chamar. */
  execucao: ExecucaoRegistrada | null;
}

type ProdutoCatalogo = { id: string; nome: string; unidade: string; categoria: string | null };

/** Tira caracteres de controle e corta: a descrição vem da nota e é dado, não instrução. */
function limpar(texto: string): string {
  const semControle = [...texto].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? " " : c));
  return semControle.join("").trim().slice(0, DESCRICAO_MAXIMA);
}

/**
 * Sugere, com o modelo, o produto do cadastro para itens da nota que o código de barras, a memória
 * do dono e a similaridade não ligaram (issue #27). O modelo só escolhe entre produtos do próprio
 * comerciante, por referência local; o código valida a referência e traduz para o id. Qualquer falha
 * vira "sem sugestão": a pergunta ao dono segue só com os candidatos da similaridade.
 */
export class SugestorVinculo {
  constructor(
    private readonly cliente: ClienteSugestao,
    private readonly prompt: PromptVinculo,
    private readonly opcoes: { modeloConfigurado: string },
  ) {}

  async sugerir(
    db: Executor,
    comercianteId: string,
    documentoId: string,
    itens: ItemSemVinculo[],
    fornecedorNome: string,
  ): Promise<ResultadoSugestao> {
    const vazio: ResultadoSugestao = { sugestoes: new Map(), execucao: null };
    if (itens.length === 0) return vazio;
    const catalogo = await this.carregarCatalogo(db, comercianteId, itens);
    if (catalogo.length === 0) return vazio;

    const refItem = new Map(itens.map((i, n) => [`i${n + 1}`, i]));
    const refProduto = new Map(catalogo.map((p, n) => [`p${n + 1}`, p]));
    const usuario =
      "<dados>" +
      JSON.stringify({
        fornecedor: limpar(fornecedorNome),
        itens: [...refItem].map(([ref, i]) => ({
          ref,
          descricao: limpar(i.descricao),
          unidade: limpar(i.unidade),
        })),
        catalogo: [...refProduto].map(([ref, p]) => ({
          ref,
          nome: limpar(p.nome),
          unidade: limpar(p.unidade),
          categoria: p.categoria ? limpar(p.categoria) : null,
        })),
      }) +
      "</dados>";

    const inicio = performance.now();
    let modelo = this.opcoes.modeloConfigurado;
    let consumo = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };
    let resultado: ResultadoExecucao = "fallback_erro";
    let erro: string | null = null;
    const sugestoes = new Map<number, SugestaoModelo>();
    let invalidas = 0;

    try {
      const resposta = await this.cliente.sugerir({
        sistema: this.prompt.texto,
        usuario,
        esquemaSaida: sugestaoModeloSchema,
      });
      modelo = resposta.modelo || modelo;
      consumo = resposta.consumo;
      if (resposta.recusou) {
        resultado = "recusa_modelo";
      } else {
        const lido = sugestaoModeloSchema.safeParse(JSON.parse(resposta.texto));
        if (!lido.success) {
          erro = "Saída fora do esquema";
        } else {
          resultado = "aprovada";
          for (const s of lido.data.sugestoes) {
            const item = refItem.get(s.item);
            if (!item || sugestoes.has(item.ordem)) {
              invalidas++;
              continue;
            }
            if (s.produto === null) continue;
            const prod = refProduto.get(s.produto);
            if (!prod) {
              // Referência que não foi enviada: o modelo inventou um produto.
              invalidas++;
              continue;
            }
            sugestoes.set(item.ordem, {
              produtoId: prod.id,
              nome: prod.nome,
              confianca: Math.min(s.confianca, CONFIANCA_MAXIMA_MODELO),
            });
          }
        }
      }
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
    }

    return {
      sugestoes,
      execucao: {
        comercianteId,
        gatilho: "vinculo_produto",
        entrada: `documento:${documentoId}`,
        modelo,
        versaoPrompt: this.prompt.versao,
        resultado,
        mensagemFinal: `Sugeridos ${sugestoes.size} de ${itens.length} itens${invalidas > 0 ? ` (${invalidas} descartadas)` : ""}`,
        iteracoes: 1,
        bloqueios: [],
        tokensEntrada: consumo.entrada,
        tokensSaida: consumo.saida,
        tokensCacheLeitura: consumo.cacheLeitura,
        custoEstimadoMicrodolares: custoMicrodolares(modelo, consumo),
        latenciaMs: Math.round(performance.now() - inicio),
        erro,
        chamadas: [],
      },
    };
  }

  private async carregarCatalogo(
    db: Executor,
    comercianteId: string,
    itens: ItemSemVinculo[],
  ): Promise<ProdutoCatalogo[]> {
    const todos = await db.execute<ProdutoCatalogo>(sql`
      select id, nome, unidade, categoria from produto
       where comerciante_id = ${comercianteId}
       order by nome
    `);
    if (todos.rows.length <= CATALOGO_COMPLETO_ATE) return todos.rows;

    const escolhidos = new Map<string, ProdutoCatalogo>();
    for (const item of itens) {
      const parecidos = await db.execute<ProdutoCatalogo>(sql`
        select id, nome, unidade, categoria from produto
         where comerciante_id = ${comercianteId}
         order by word_similarity(${normalizarDescricao(item.descricao)}, upper(nome)) desc
         limit ${PARECIDOS_POR_ITEM}
      `);
      for (const p of parecidos.rows) escolhidos.set(p.id, p);
    }
    return [...escolhidos.values()];
  }
}
