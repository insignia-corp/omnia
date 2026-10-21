import { readFileSync } from "node:fs";
import path from "node:path";
import { custoMicrodolares, temPreco } from "../../agente/llm/modelo-linguagem";
import {
  ErroClienteVisao,
  type ClienteVisao,
  type ConsumoExtracao,
  type ImagemNota,
  type TipoImagem,
} from "../../ingestao/extracao/cliente-visao";
import {
  extracaoNotaSchema,
  LIMITE_CONFIANCA_ITEM,
  type ExtracaoNota,
} from "../../ingestao/extracao/esquema-extracao";
import type { ExtratorNotas, TipoFalhaExtracao } from "../../ingestao/extracao/extrator-notas";
import { validarNota, type CodigoMotivo } from "../../ingestao/validacao/validar-nota";
import { CAMPOS_DOCUMENTO, CAMPOS_ITEM, compararNota, type ComparacaoNota } from "./comparador";

/** Uma foto de `fixtures/notas/` com o gabarito de extração dela. */
export interface NotaDeTeste {
  id: string;
  arquivoImagem: string;
  mediaType: TipoImagem;
  esperado: ExtracaoNota;
  /** Casos difíceis do manifesto (`foto_inclinada`, `texto_de_injecao`...). */
  casos: string[];
}

export type FalhaDaNota = TipoFalhaExtracao | "erro_transitorio";

export interface ResultadoNota {
  id: string;
  casos: string[];
  /** `null` quando o Extrator não devolveu nota (falha). */
  comparacao: ComparacaoNota | null;
  /**
   * O que a especificação exige desta nota, vindo do gabarito e do manifesto: item borrado abaixo do limite,
   * documento em dúvida abaixo do limite, soma divergente detectada em código. Vale mesmo quando a nota não saiu.
   */
  exigencias: ExigenciasNota;
  /** Campos e itens do gabarito, para contar como errada a nota que não saiu. */
  camposEsperados: number;
  itensEsperados: number;
  /** O que o Extrator devolveu depois das validações em código, como o processador grava. */
  extracao: ExtracaoNota | null;
  falha: { tipo: FalhaDaNota; mensagem: string } | null;
  /** Conferências em código que reduziram a confiança (soma, CNPJ, data, item). */
  motivosValidacao: CodigoMotivo[];
  consumo: ConsumoExtracao;
  /** `null`: modelo sem preço cadastrado, custo indisponível (nunca zero). */
  custoEstimadoMicrodolares: number | null;
  latenciaMs: number;
  tentativas: number;
  modelo: string;
  versaoPrompt: string;
}

export interface ExigenciasNota {
  /** Posições (a partir de 1) de itens que o gabarito marca como pouco legíveis e têm de sair abaixo do limite. */
  itensAbaixoDoLimite: number[];
  documentoAbaixoDoLimite: boolean;
  /** Caso `soma_diverge_do_total` do manifesto: o código tem de acusá-lo em `motivosValidacao`. */
  somaDivergente: boolean;
}

export interface RodadaExtracao {
  iniciadaEm: string;
  modo: "falso" | "real";
  /** Modelo pedido (o devolvido por nota está em cada resultado). */
  modelo: string;
  versaoPrompt: string;
  limiteConfianca: number;
  /** Data de hoje usada nas validações em código. */
  hoje: string;
  resultados: ResultadoNota[];
}

const TIPOS: Record<string, TipoImagem> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function lerJson(raiz: string, arquivo: string): unknown {
  return JSON.parse(readFileSync(path.resolve(raiz, arquivo), "utf8"));
}

interface EntradaManifesto {
  id: string;
  arquivo_imagem: string | null;
  arquivo_esperado: string;
  casos: string[];
}

/**
 * Notas com foto do manifesto (a NF-e em XML não passa pelo modelo com visão). O gabarito é lido pelo
 * mesmo esquema Zod do Extrator: um gabarito fora do formato derruba a avaliação antes de gastar uma chamada.
 */
export function carregarNotas(raiz = "."): NotaDeTeste[] {
  const manifesto = lerJson(raiz, "fixtures/notas/manifesto.json") as EntradaManifesto[];
  return manifesto.flatMap((m) => {
    if (!m.arquivo_imagem) return [];
    const mediaType = TIPOS[path.extname(m.arquivo_imagem).toLowerCase()];
    if (!mediaType) throw new Error(`Tipo de imagem não suportado: ${m.arquivo_imagem}`);
    return [
      {
        id: m.id,
        arquivoImagem: path.resolve(raiz, "fixtures/notas", m.arquivo_imagem),
        mediaType,
        esperado: extracaoNotaSchema.parse(lerJson(raiz, `fixtures/notas/${m.arquivo_esperado}`)),
        casos: m.casos,
      },
    ];
  });
}

/** "Hoje" das validações: o dia seguinte à data de referência do gabarito, como no harness do agente. */
export function hojeDoGabarito(raiz = "."): string {
  const g = lerJson(raiz, "fixtures/gabarito/metricas.json") as { parametros: { data_referencia: string } };
  const dia = new Date(`${g.parametros.data_referencia}T00:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + 1);
  return dia.toISOString().slice(0, 10);
}

export function imagemDaNota(nota: NotaDeTeste): ImagemNota {
  return { mediaType: nota.mediaType, base64: readFileSync(nota.arquivoImagem).toString("base64") };
}

export const NOME_MODELO_FALSO = "extrator-falso";

const SEM_CONSUMO: ConsumoExtracao = { entrada: 0, saida: 0, cacheLeitura: 0, cacheEscrita: 0 };

/**
 * Custo da nota. No modo falso não há custo. No real, modelo sem preço em `PRECOS` (ou o modelo de um
 * fallback do servidor) daria zero em `custoMicrodolares`: aqui vira `null`, para o relatório não
 * registrar uma avaliação paga como US$ 0. Sem token gasto, o custo é zero de verdade.
 */
function custoDaNota(modo: "falso" | "real", modelo: string, consumo: ConsumoExtracao): number | null {
  if (modo === "falso") return 0;
  if (consumo.entrada + consumo.saida + consumo.cacheLeitura + consumo.cacheEscrita === 0) return 0;
  return temPreco(modelo) ? custoMicrodolares(modelo, consumo) : null;
}

export interface OpcoesAvaliacaoExtracao {
  extrator: ExtratorNotas;
  notas: NotaDeTeste[];
  hoje: string;
  modo: "falso" | "real";
  modelo: string;
  versaoPrompt: string;
  limiteConfianca?: number;
}

/**
 * Passa cada foto pelo Extrator e pelas validações em código, na ordem em que o processador da ingestão
 * faz, e compara o que seria gravado com o gabarito. Em sequência: uma nota com erro não para as outras.
 */
export async function avaliarExtracao(opcoes: OpcoesAvaliacaoExtracao): Promise<RodadaExtracao> {
  const limite = opcoes.limiteConfianca ?? LIMITE_CONFIANCA_ITEM;
  const iniciadaEm = new Date().toISOString();
  const resultados: ResultadoNota[] = [];
  for (const nota of opcoes.notas) {
    const inicio = Date.now();
    const base = {
      id: nota.id,
      casos: nota.casos,
      versaoPrompt: opcoes.versaoPrompt,
      camposEsperados: CAMPOS_DOCUMENTO.length + nota.esperado.itens.length * CAMPOS_ITEM.length,
      itensEsperados: nota.esperado.itens.length,
      exigencias: {
        itensAbaixoDoLimite: nota.esperado.itens.flatMap((i, k) => (i.confianca < limite ? [k + 1] : [])),
        documentoAbaixoDoLimite: nota.esperado.confianca_documento < limite,
        somaDivergente: nota.casos.includes("soma_diverge_do_total"),
      },
    };
    // Fora do try: foto ausente ou ilegível é falha do avaliador e derruba a rodada, não vira falha da nota.
    const imagem = imagemDaNota(nota);
    try {
      const r = await opcoes.extrator.extrair(imagem);
      const custo = custoDaNota(opcoes.modo, r.modelo, r.consumo);
      if (!r.ok) {
        resultados.push({
          ...base,
          comparacao: null,
          extracao: null,
          falha: { tipo: r.erro, mensagem: r.mensagem },
          motivosValidacao: [],
          consumo: r.consumo,
          custoEstimadoMicrodolares: custo,
          latenciaMs: r.latenciaMs,
          tentativas: r.tentativas,
          modelo: r.modelo,
          versaoPrompt: r.versaoPrompt,
        });
        continue;
      }
      const validada = validarNota(r.extracao, { hoje: opcoes.hoje, limiteConfiancaItem: limite });
      resultados.push({
        ...base,
        comparacao: compararNota(nota.esperado, validada.extracao),
        extracao: validada.extracao,
        falha: null,
        motivosValidacao: [...new Set(validada.motivos.map((m) => m.codigo))],
        consumo: r.consumo,
        custoEstimadoMicrodolares: custo,
        latenciaMs: r.latenciaMs,
        tentativas: r.tentativas,
        modelo: r.modelo,
        versaoPrompt: r.versaoPrompt,
      });
    } catch (e) {
      // Só o erro transitório do cliente de visão (timeout, 429, 5xx) sobe do Extrator para o job tentar de novo;
      // aqui conta como falha da nota. Qualquer outra exceção é do avaliador e não pode certificar a rodada.
      if (!(e instanceof ErroClienteVisao)) throw e;
      resultados.push({
        ...base,
        comparacao: null,
        extracao: null,
        falha: { tipo: "erro_transitorio", mensagem: e.message },
        motivosValidacao: [],
        consumo: { ...SEM_CONSUMO },
        custoEstimadoMicrodolares: 0,
        latenciaMs: Date.now() - inicio,
        tentativas: 1,
        modelo: opcoes.modelo,
      });
    }
  }
  return {
    iniciadaEm,
    modo: opcoes.modo,
    modelo: opcoes.modelo,
    versaoPrompt: opcoes.versaoPrompt,
    limiteConfianca: limite,
    hoje: opcoes.hoje,
    resultados,
  };
}

/**
 * Cliente de visão do modo falso: "lê" a foto devolvendo o gabarito dela. Prova que o caminho (Extrator,
 * validações, comparador, relatório) funciona sem rede e sem custo; não diz nada sobre o modelo real.
 */
export function clienteFalsoDoGabarito(notas: NotaDeTeste[]): ClienteVisao {
  const porImagem = new Map(notas.map((n) => [imagemDaNota(n).base64, JSON.stringify(n.esperado)]));
  return {
    extrair(pedido) {
      const texto = porImagem.get(pedido.imagem.base64);
      if (!texto) return Promise.reject(new Error("foto fora das fixtures no cliente de visão falso"));
      return Promise.resolve({
        texto,
        recusou: false,
        consumo: { ...SEM_CONSUMO },
        modelo: NOME_MODELO_FALSO,
      });
    },
  };
}
