import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { TurnoConversa } from "../agente/conversa/historico";
import type { Gatilho, ResultadoExecucao } from "../agente/execucao/registro-execucoes";
import type { Ferramenta } from "../agente/ferramentas/ferramenta";

/** Tipos de pergunta de `fixtures/avaliacao/perguntas.json`, mais `verificador` (número inventado). */
export type CategoriaCaso =
  "numerica" | "verificador" | "sem_resposta" | "injecao" | "acao_com_confirmacao" | "medicao";

export type UnidadeNumero = "centavos" | "cupons" | "unidades" | "dias" | "percentual";

/** Número que a mensagem tem de conter, como o gabarito registra (dinheiro em centavos). */
export interface NumeroEsperado {
  rotulo: string;
  valor: number;
  unidade: UnidadeNumero;
  /**
   * Palavras que identificam o número na mensagem (ex.: `/ontem/`, `/28 dias|anteriores/`). Obrigatório
   * quando outro número esperado do caso tem a mesma unidade: sem ele, um valor trocado por outro
   * passaria, porque só o valor seria conferido, não o que ele significa.
   */
  contexto?: RegExp;
}

/** Como o caso é julgado, além de chamar as ferramentas esperadas. */
export type Criterio =
  /**
   * Mensagem aprovada pelo verificador, com cada número esperado escrito nela e, em `textos`, os nomes
   * (produto, fornecedor) que o gabarito espera citados, sem diferenciar maiúscula nem acento.
   */
  | { tipo: "numero_correto"; numeros: NumeroEsperado[]; textos?: string[] }
  /** O modelo roteirizado inventa um número: o verificador tem de barrar e nada fora das ferramentas sai. */
  | {
      tipo: "bloqueio_verificador";
      minBloqueios: number;
      resultadoFinal: Extract<ResultadoExecucao, "aprovada" | "fallback_verificador">;
    }
  /**
   * Caso de medição de custo e tempo (#74): sem número esperado, porque a escolha dos alertas ainda não tem
   * gabarito. Passa quando o verificador aprova a mensagem; o que importa é o custo e a latência registrados.
   */
  | { tipo: "medicao" }
  /** Diz que não sabe, sem número, e não responde com dado inventado. */
  | { tipo: "sem_resposta"; padraoNaoSei?: RegExp }
  /**
   * Regra inviolável 6: texto do dono (ou de nota) é dado, nunca instrução. Aprovada, sem chamar ferramenta
   * de escrita, sem `comerciante_id` nem id vindo do texto em nenhuma chamada, sem o que o texto pedia.
   */
  | {
      tipo: "injecao";
      /** Ferramentas de escrita: nenhuma pode ser chamada por causa do texto injetado. */
      ferramentasProibidas: string[];
      /** O que o texto injetado quer ver na mensagem (telefone, valor arredondado). Nada disso pode aparecer. */
      padroesProibidos?: RegExp[];
      /** Quando a pergunta tem resposta certa (ex.: q44), os números exatos do gabarito, como em `numero_correto`. */
      numeros?: NumeroEsperado[];
      /** Palavras da recusa ou da explicação ("só informo", "preciso da confirmação"). */
      padraoRecusa?: RegExp;
      /**
       * Ferramentas que, chamadas sem erro, dispensam a recusa: o dado vem delas e o verificador o conferiu.
       * Qualquer outra ferramenta não dispensa: o número poderia ser de outra métrica, rotulado como a pedida.
       */
      recusaDispensadaPor?: string[];
    };

/** Resposta pronta do modelo roteirizado (modo falso). */
export type RespostaRoteirizada = BetaMessage;

export interface CasoAvaliacao {
  id: string;
  categoria: CategoriaCaso;
  /** Pergunta ou situação, como aparece no relatório. */
  descricao: string;
  gatilho: Gatilho;
  /** Texto do dono (ou descrição do evento, nos gatilhos automáticos). */
  entrada: string;
  /** Sem valor, vale a data da rodada. */
  dataReferencia?: string;
  historico?: TurnoConversa[];
  /** Todas têm de ser chamadas pelo menos uma vez. Vazio quando o caso não exige ferramenta. */
  ferramentasEsperadas: string[];
  criterio: Criterio;
  /** Só no modo falso: o que o modelo roteirizado responde, na ordem. */
  roteiro?: RespostaRoteirizada[];
  /** Dublês que ocupam o lugar das ferramentas de mesmo nome do catálogo (no modo real, só com `dubleNoModoReal`). */
  ferramentasFalsas?: Ferramenta[];
  /**
   * Mantém os dublês também no modo real. Só para ferramenta que o plano A ainda não entregou (hoje
   * `list_alert_candidates`, #52): o modelo é o real, os dados vêm do gabarito. Dublê no modo real tem de
   * estar dito na `descricao` do caso, que aparece no relatório.
   */
  dubleNoModoReal?: boolean;
}

export type ModoModelo = "falso" | "real";

export interface ChamadaDoCaso {
  ferramenta: string;
  erro: string | null;
  latenciaMs: number;
}

export interface ResultadoCaso {
  id: string;
  categoria: CategoriaCaso;
  /** O que disparou a execução: o custo e o tempo (#74) saem por gatilho. */
  gatilho: Gatilho;
  descricao: string;
  aprovado: boolean;
  /** Vazio quando aprovado. Um motivo por critério que falhou. */
  motivos: string[];
  resultadoAgente: ResultadoExecucao | "sem_execucao";
  mensagem: string;
  ferramentasChamadas: ChamadaDoCaso[];
  bloqueios: number;
  iteracoes: number;
  modelo: string;
  custoEstimadoMicrodolares: number;
  latenciaMs: number;
  tokensEntrada: number;
  tokensSaida: number;
  execucaoId: string | null;
}

export interface Rodada {
  iniciadaEm: string;
  modo: ModoModelo;
  /** Modelo configurado (no modo falso, o nome do roteirizado). */
  modelo: string;
  versaoPrompt: string;
  comerciante: string;
  dataReferencia: string;
  resultados: ResultadoCaso[];
}
