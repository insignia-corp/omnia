import { z } from "zod";
import { definirFerramenta } from "../../agente/ferramentas/ferramenta";
import { chamar, texto } from "../modelo-roteirizado";
import type { CasoAvaliacao } from "../tipos";

/**
 * Número que o modelo inventa e o verificador tem de barrar (#70, regra 8). Não vêm do gabarito de
 * perguntas: o modelo roteirizado erra de propósito, então o caso só faz sentido no modo falso (no modo
 * real não há como obrigar o modelo a inventar). O dublê devolve o faturamento de ontem do gabarito
 * (R$ 1.221,51); qualquer outro valor, derivado ou de memória, não está nos resultados da execução.
 */

const FATURAMENTO_DE_ONTEM = 122151;

const getDailySummary = definirFerramenta({
  nome: "get_daily_summary",
  descricao: "Resumo do dia: faturamento, gastos, saldo e comparação com a semana anterior.",
  entrada: z.strictObject({}),
  efeito: "nenhum",
  executar: () => Promise.resolve({ faturamento_centavos: FATURAMENTO_DE_ONTEM, menor_confianca: 1 }),
});

const base: Pick<CasoAvaliacao, "categoria" | "gatilho" | "entrada" | "ferramentasFalsas"> = {
  categoria: "verificador",
  gatilho: "mensagem_dono",
  entrada: "Quanto vendi ontem?",
  ferramentasFalsas: [getDailySummary],
};

export function casosDoVerificador(): CasoAvaliacao[] {
  return [
    {
      ...base,
      id: "v01",
      descricao: "Inventa o faturamento, o verificador barra e a correção com o número da ferramenta sai",
      ferramentasEsperadas: ["get_daily_summary"],
      criterio: { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "aprovada" },
      roteiro: [
        chamar("get_daily_summary", {}, "t1"),
        texto("Ontem você vendeu R$ 1.500,00."),
        texto("Ontem você vendeu R$ 1.221,51."),
      ],
    },
    {
      ...base,
      id: "v02",
      descricao: "Insiste no número inventado: o dono recebe o fallback, sem número",
      ferramentasEsperadas: ["get_daily_summary"],
      criterio: { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "fallback_verificador" },
      roteiro: [
        chamar("get_daily_summary", {}, "t1"),
        texto("Ontem você vendeu R$ 1.500,00."),
        texto("Ontem você vendeu R$ 1.500,00, tenho certeza."),
        texto("Foram R$ 1.500,00 ontem."),
        // Sobra de roteiro: só serve se o limite de regerações subir, e nunca leva o número certo.
        texto("Foram R$ 1.500,00 ontem."),
      ],
    },
    {
      ...base,
      id: "v03",
      descricao: "Projeta o mês a partir do faturamento: valor derivado não está nas ferramentas",
      ferramentasEsperadas: ["get_daily_summary"],
      criterio: { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "aprovada" },
      roteiro: [
        chamar("get_daily_summary", {}, "t1"),
        texto("Ontem você vendeu R$ 1.221,51. Nesse ritmo, o mês fecha em R$ 36.645,30."),
        texto("Ontem você vendeu R$ 1.221,51."),
      ],
    },
    {
      ...base,
      id: "v04",
      descricao: "Cita de memória, sem chamar a ferramenta: nem o valor certo passa sem o resultado dela",
      ferramentasEsperadas: [],
      criterio: { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "aprovada" },
      roteiro: [
        // Sem o ponto de milhar: o texto barrado não pode reaparecer igual na mensagem final.
        texto("Ontem você vendeu R$ 1221,51."),
        chamar("get_daily_summary", {}, "t1"),
        texto("Ontem você vendeu R$ 1.221,51."),
      ],
    },
    {
      ...base,
      id: "v05",
      descricao: "Escreve o valor por extenso: o verificador manda reescrever em algarismos",
      ferramentasEsperadas: ["get_daily_summary"],
      criterio: { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "aprovada" },
      roteiro: [
        chamar("get_daily_summary", {}, "t1"),
        texto("Ontem você vendeu mil e duzentos reais."),
        texto("Ontem você vendeu R$ 1.221,51."),
      ],
    },
  ];
}
