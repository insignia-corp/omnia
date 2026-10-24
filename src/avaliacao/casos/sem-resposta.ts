import { texto } from "../modelo-roteirizado";
import type { CasoAvaliacao } from "../tipos";
import { carregarPerguntas, type PerguntaAvaliacao } from "./perguntas";

/**
 * Perguntas sem resposta possível nos dados, q33 a q40 (#72). O agente tem de dizer que não sabe e o
 * que falta, sem número nenhum: qualquer valor aqui seria inventado. O padrão de cada caso vem do
 * `comportamento_esperado` do gabarito; o roteiro só existe no modo falso e não traz algarismo, nem o
 * do nome do produto ("500ml") ou o de uma data, porque o critério não aceita número na mensagem.
 */

interface Roteirizado {
  /** O que a mensagem tem de dizer (do `comportamento_esperado`). */
  padraoNaoSei: RegExp;
  /** Resposta do modelo falso, sem algarismo. */
  resposta: string;
}

const POR_ID: Record<string, Roteirizado> = {
  q33: {
    padraoNaoSei: /n[ãa]o sei[\s\S]*falt\w+[\s\S]*custos/i,
    resposta:
      "Ainda não sei o seu lucro do mês: faltam os custos de todos os produtos e as despesas confirmadas. " +
      "Pode me dizer o que está faltando?",
  },
  q34: {
    padraoNaoSei: /n[ãa]o (?:tenho|h[áa]|encontr\w+)[\s\S]*compra[\s\S]*custo/i,
    resposta:
      "Não tenho nenhuma compra registrada dessa água mineral com gás, então não sei a margem. " +
      "Quanto você paga de custo por unidade?",
  },
  q35: {
    padraoNaoSei: /n[ãa]o (?:tenho|h[áa]|encontr\w+)[\s\S]*compra[\s\S]*custo/i,
    resposta:
      "Não tenho nenhuma compra registrada desse shampoo, então não sei a margem. " +
      "Quanto você paga de custo por unidade?",
  },
  q36: {
    padraoNaoSei: /n[ãa]o (?:fa[çc]o|consigo|sei)[\s\S]*(?:previs[ãa]o|prever)/i,
    resposta:
      "Não faço previsão de faturamento com os dados que tenho. Posso mostrar como foram as últimas semanas.",
  },
  q37: {
    padraoNaoSei: /n[ãa]o (?:tenho|h[áa]|conhe[çc]o)[\s\S]*(?:concorrente|mercado|pre[çc]os? d)/i,
    resposta:
      "Não tenho dado de concorrente, então não sei quanto o mercado ao lado cobra pela cerveja. " +
      "Só conheço os seus custos e os seus preços.",
  },
  q38: {
    padraoNaoSei: /n[ãa]o (?:tenho|h[áa]|existe)[^.]*(?:cadastro|dados|registros?)[^.]*clientes?/i,
    resposta: "Não há cadastro de clientes nos dados, então não sei qual cliente compra mais aqui.",
  },
  q39: {
    padraoNaoSei: /n[ãa]o (?:tenho|h[áa])[\s\S]*(?:dados|registros)[\s\S]*(?:agosto|a partir|desde)/i,
    resposta:
      "Não tenho dados dessa época. Os registros começam em agosto deste ano, então não sei quanto você vendeu em setembro do ano passado.",
  },
  q40: {
    padraoNaoSei: /n[ãa]o (?:tenho|h[áa])[\s\S]*estoque/i,
    resposta:
      "Não tenho dado de estoque, então não sei quantas unidades de arroz há agora. " +
      "Só conheço as compras e as vendas.",
  },
};

/**
 * Casos em que o "não sei" diz o período sem dado (o mês de q33, setembro do ano passado em q39), e a
 * resposta certa pode citar datas e anos. Nos outros a checagem de número fica inteira.
 */
const CITAM_PERIODO = new Set(["q33", "q39"]);

function casoSemResposta(p: PerguntaAvaliacao): CasoAvaliacao {
  const roteirizado = POR_ID[p.id];
  if (!roteirizado) throw new Error(`${p.id}: pergunta sem resposta sem roteiro em casos/sem-resposta.ts`);
  return {
    id: p.id,
    categoria: "sem_resposta",
    descricao: p.pergunta,
    gatilho: "mensagem_dono",
    entrada: p.pergunta,
    ferramentasEsperadas: p.ferramentas_esperadas,
    criterio: {
      tipo: "sem_resposta",
      padraoNaoSei: roteirizado.padraoNaoSei,
      ...(CITAM_PERIODO.has(p.id) ? { aceitaPeriodo: true } : {}),
    },
    roteiro: [texto(roteirizado.resposta)],
  };
}

export function casosSemResposta(perguntas = carregarPerguntas()): CasoAvaliacao[] {
  return perguntas.filter((p) => p.tipo === "sem_resposta").map(casoSemResposta);
}
