import { z } from "zod";
import { definirFerramenta, type Ferramenta } from "../../agente/ferramentas/ferramenta";
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { chamar, texto } from "../modelo-roteirizado";
import type { CasoAvaliacao, NumeroEsperado, UnidadeNumero } from "../tipos";
import { carregarPerguntas, type PerguntaAvaliacao } from "./perguntas";

/**
 * Perguntas numéricas do gabarito, q01 a q32 (#69). Todo número e todo nome esperado vem de
 * `fixtures/avaliacao/perguntas.json`; aqui só entram o roteiro e os dublês do modo falso e os
 * `contexto` dos casos em que dois números têm a mesma unidade (sem eles, um valor trocado passaria).
 */

/**
 * Palavras que identificam cada número quando outro da mesma unidade está no caso. Chave: id da pergunta
 * e rótulo do gabarito. O rótulo não é usado como regex porque o modelo real o parafraseia.
 */
const CONTEXTOS: Record<string, Record<string, RegExp>> = {
  q04: {
    "ticket médio de ontem": /ontem/i,
    "ticket médio dos 28 dias anteriores": /anteriores|semanas|m[ée]dia/i,
  },
  q11: {
    "faturamento de ontem": /ontem/i,
    "média dos 7 dias anteriores": /m[ée]dia|anteriores|semana/i,
  },
  q12: {
    "gasto de ontem": /ontem|gasto/i,
    "mediana dos 60 dias": /mediana|normal|t[íi]pic|costum/i,
  },
  q25: {
    "custo anterior": /anterior|antes|era\b|(?:passou|subiu|foi)\s+de\s*R\$/i,
    "custo atual": /atual|agora|passou|hoje|para\s+R\$/i,
  },
  q26: {
    "custo anterior": /anterior|antes|era\b|(?:passou|subiu|foi)\s+de\s*R\$/i,
    "custo atual": /atual|agora|passou|hoje|para\s+R\$/i,
  },
  q27: {
    "reajuste de Arroz branco tipo 1 5kg": /arroz/i,
    "reajuste de Óleo de soja 900ml": /[óo]leo/i,
  },
  q29: {
    "margem atual": /atual|hoje/i,
    "meta de margem": /meta/i,
  },
};

const CHAVE_DO_VALOR: Record<UnidadeNumero, string> = {
  centavos: "valor_centavos",
  percentual: "valor_percentual",
  cupons: "valor_cupons",
  unidades: "valor_unidades",
  dias: "valor_dias",
};

/**
 * Casos em que a resposta em lista afasta o nome do produto do percentual (q27: um item por produto):
 * a janela vai desde o início da linha, e o nome do outro produto não pode aparecer antes do número.
 */
const LISTA_POR_PRODUTO: Record<string, Record<string, RegExp>> = {
  q27: {
    "reajuste de Arroz branco tipo 1 5kg": /[óo]leo/i,
    "reajuste de Óleo de soja 900ml": /arroz/i,
  },
};

function numerosEsperados(p: PerguntaAvaliacao): NumeroEsperado[] {
  const contextos = CONTEXTOS[p.id] ?? {};
  const lista = LISTA_POR_PRODUTO[p.id] ?? {};
  return p.numeros_esperados.map((n) => {
    const contexto = contextos[n.rotulo];
    if (!contexto) return n;
    const excluido = lista[n.rotulo];
    return excluido
      ? { ...n, contexto, janelaPorLinha: true, contextoExcluido: excluido }
      : { ...n, contexto };
  });
}

function escrever(n: { valor: number; unidade: UnidadeNumero }): string {
  switch (n.unidade) {
    case "centavos":
      return formatarBRL(centavos(n.valor));
    case "percentual":
      return `${String(n.valor).replace(".", ",")}%`;
    default:
      return `${n.valor} ${n.unidade}`;
  }
}

const capitalizar = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Dublê de uma ferramenta de leitura do plano A: devolve os valores do gabarito, como a real devolverá.
 * O rótulo e os nomes vão como texto no resultado: os dígitos deles ("17/10", "5kg") também são
 * autorizados pelo verificador, como seriam os de um nome de produto vindo do banco.
 */
function ferramentaFalsa(nome: string, p: PerguntaAvaliacao): Ferramenta {
  return definirFerramenta({
    nome,
    descricao: `Dublê de ${nome} para o modo falso da avaliação.`,
    entrada: z.strictObject({}),
    efeito: "nenhum",
    executar: () =>
      Promise.resolve({
        itens: p.numeros_esperados.map((n) => ({ rotulo: n.rotulo, [CHAVE_DO_VALOR[n.unidade]]: n.valor })),
        produtos: p.textos_esperados,
        menor_confianca: 1,
      }),
  });
}

function mensagemDoGabarito(p: PerguntaAvaliacao): string {
  const rotulos = p.numeros_esperados.map((n) => n.rotulo.toLocaleLowerCase("pt-BR"));
  // Nome que o rótulo já traz não se repete; os demais abrem a mensagem, longe das janelas dos números.
  const nomes = p.textos_esperados.filter(
    (t) => !rotulos.some((r) => r.includes(t.toLocaleLowerCase("pt-BR"))),
  );
  const partes = p.numeros_esperados.map((n) => `${capitalizar(n.rotulo)}: ${escrever(n)}`);
  const abertura = nomes.length > 0 ? `Produtos: ${nomes.join(", ")}. ` : "";
  return `${abertura}${partes.join("; ")}.`;
}

/**
 * Ferramenta equivalente aceita no lugar de uma esperada, quando a resposta certa veio por outro caminho:
 * q05 (últimos 7 dias) por `get_period_summary` no lugar de `get_daily_summary`; q27 (reajuste de
 * fornecedor) por `get_cost_changes` e q29 (posso subir o preço) por `get_product_margin`, no lugar de
 * `list_alert_candidates`. Trazem os números que o caso confere (total do período, reajuste, margem e
 * meta); o giro que q29 menciona no gabarito não tem checagem numérica, então a alternativa não o exige.
 */
const ALTERNATIVAS: Record<string, Record<string, string[]>> = {
  q05: { get_daily_summary: ["get_period_summary"] },
  q27: { list_alert_candidates: ["get_cost_changes"] },
  q29: { list_alert_candidates: ["get_product_margin"] },
};

function casoNumerico(p: PerguntaAvaliacao): CasoAvaliacao {
  if (p.numeros_esperados.length === 0) throw new Error(`${p.id}: pergunta numérica sem número esperado`);
  return {
    id: p.id,
    categoria: "numerica",
    descricao: p.pergunta,
    gatilho: "mensagem_dono",
    entrada: p.pergunta,
    ferramentasEsperadas: p.ferramentas_esperadas,
    ...(ALTERNATIVAS[p.id] ? { ferramentasAlternativas: ALTERNATIVAS[p.id] } : {}),
    criterio: {
      tipo: "numero_correto",
      numeros: numerosEsperados(p),
      ...(p.textos_esperados.length > 0 ? { textos: p.textos_esperados } : {}),
    },
    roteiro: [
      ...p.ferramentas_esperadas.map((nome, i) => chamar(nome, {}, `t${i + 1}`)),
      texto(mensagemDoGabarito(p)),
    ],
    ferramentasFalsas: p.ferramentas_esperadas.map((nome) => ferramentaFalsa(nome, p)),
  };
}

export function casosNumericos(perguntas = carregarPerguntas()): CasoAvaliacao[] {
  return perguntas.filter((p) => p.tipo === "numerica").map(casoNumerico);
}
