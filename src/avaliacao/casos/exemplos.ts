import { z } from "zod";
import { definirFerramenta } from "../../agente/ferramentas/ferramenta";
import { centavos, formatarBRL } from "../../lib/dinheiro/dinheiro";
import { chamar, texto } from "../modelo-roteirizado";
import type { CasoAvaliacao } from "../tipos";
import { perguntaPorId, type PerguntaAvaliacao } from "./perguntas";

/**
 * Casos de exemplo que provam o harness (#68). Os casos de verdade são das issues #69 a #74.
 * Pergunta, ferramenta e número esperados vêm do gabarito; o roteiro e o dublê só existem no modo falso.
 */

function faturamentoDeOntem(p: PerguntaAvaliacao): CasoAvaliacao {
  const esperado = p.numeros_esperados[0];
  if (!esperado || esperado.unidade !== "centavos") throw new Error(`${p.id}: esperava um valor em centavos`);
  // Dublê do get_daily_summary (plano A): devolve o número do gabarito, como a ferramenta real devolverá.
  const getDailySummary = definirFerramenta({
    nome: "get_daily_summary",
    descricao: "Resumo do dia: faturamento, gastos, saldo e comparação com a semana anterior.",
    entrada: z.strictObject({}),
    efeito: "nenhum",
    executar: () => Promise.resolve({ faturamento_centavos: esperado.valor, menor_confianca: 1 }),
  });
  return {
    id: p.id,
    categoria: "numerica",
    descricao: p.pergunta,
    gatilho: "mensagem_dono",
    entrada: p.pergunta,
    ferramentasEsperadas: p.ferramentas_esperadas,
    criterio: { tipo: "numero_correto", numeros: p.numeros_esperados },
    roteiro: [
      chamar("get_daily_summary", {}, "t1"),
      texto(`Ontem você vendeu ${formatarBRL(centavos(esperado.valor))}.`),
    ],
    ferramentasFalsas: [getDailySummary],
  };
}

function semRespostaPossivel(p: PerguntaAvaliacao): CasoAvaliacao {
  return {
    id: p.id,
    categoria: "sem_resposta",
    descricao: p.pergunta,
    gatilho: "mensagem_dono",
    entrada: p.pergunta,
    ferramentasEsperadas: p.ferramentas_esperadas,
    // Resposta específica do gabarito: não sabe e diz que faltam os custos.
    criterio: { tipo: "sem_resposta", padraoNaoSei: /n[ãa]o sei[\s\S]*falt\w+[\s\S]*custos/i },
    roteiro: [
      texto(
        "Ainda não sei o seu lucro do mês: faltam os custos de todos os produtos e as despesas confirmadas. " +
          "Pode me dizer o que está faltando?",
      ),
    ],
  };
}

export function casosDeExemplo(perguntas?: PerguntaAvaliacao[]): CasoAvaliacao[] {
  return [
    faturamentoDeOntem(perguntaPorId("q01", perguntas)),
    semRespostaPossivel(perguntaPorId("q33", perguntas)),
  ];
}
