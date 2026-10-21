import { z } from "zod";
import type { MotorDeAlertas } from "../../../alertas/motor-de-alertas";
import type { MotivoAusente } from "../../../alertas/regra";
import type { TipoAlerta } from "../../../alertas/tipos";
import { definirFerramenta } from "../ferramenta";

export interface CandidatoParaAgente {
  alerta_id: string;
  tipo: TipoAlerta;
  chave: string;
  prioridade: 1 | 2 | 3;
  produto_id: string | null;
  fornecedor_id: string | null;
  /** Os números do alerta, como o motor os gravou: são a fonte dos números da mensagem. */
  metricas_apoio: Record<string, unknown>;
}

export interface CandidatosDoDia {
  data: string;
  /** Do mais ao menos importante (a ordem do motor). Vazio é um resultado: não há o que alertar. */
  candidatos: CandidatoParaAgente[];
  n_registros: number;
  /** A menor confiança entre os candidatos que a informam; nula quando nenhum informa. */
  menor_confianca: number | null;
  /** Quantos candidatos o motor achou e a janela de supressão barrou (já enviados ou descartados). */
  n_suprimidos: number;
  /** Regras sem dado para a data: sem candidato, nunca zero. */
  ausentes: MotivoAusente[];
}

const confiancaDe = (metricasApoio: Record<string, unknown>): number | null =>
  typeof metricasApoio.menor_confianca === "number" ? metricasApoio.menor_confianca : null;

/**
 * Candidatos a alerta do dia (issue #52). Roda o motor de alertas para o comerciante da sessão e a
 * data de referência da execução, e devolve os candidatos para o agente escolher até 3 em
 * `select_alerts`. Nada vem do modelo: a ferramenta não tem entrada, então o modelo não escolhe
 * comerciante nem data. O motor só acrescenta linhas `candidato` derivadas das métricas e é
 * idempotente (comerciante, tipo, chave e data), sem efeito sobre dinheiro nem sobre configuração
 * do dono, então a ferramenta é de leitura do ponto de vista do dono (efeito "nenhum").
 */
export function criarListAlertCandidates(motor: MotorDeAlertas) {
  return definirFerramenta({
    nome: "list_alert_candidates",
    descricao:
      "Lista os candidatos a alerta do dia, do mais ao menos importante, com tipo, prioridade (1 a 3) e as " +
      "métricas de apoio de cada um (valores, impacto em centavos, confiança e fonte). Chame primeiro no relatório " +
      "diário e depois escolha até 3 com select_alerts, usando o alerta_id de cada candidato. Lista vazia " +
      "(candidatos: []) é um resultado válido: não há o que avisar hoje, e então não chame select_alerts. " +
      "ausentes traz as regras que ficaram sem dado (por exemplo, histórico insuficiente): diga isso ao dono, " +
      "não estime. n_suprimidos conta candidatos já enviados ou descartados há pouco tempo.",
    entrada: z.strictObject({}),
    efeito: "nenhum",
    async executar(contexto): Promise<CandidatosDoDia> {
      const resultado = await motor.executar({
        comercianteId: contexto.comercianteId,
        dataReferencia: contexto.dataReferencia,
      });
      const candidatos: CandidatoParaAgente[] = resultado.candidatos.map((c) => ({
        alerta_id: c.id,
        tipo: c.tipo,
        chave: c.chave,
        prioridade: c.prioridade,
        produto_id: c.produtoId,
        fornecedor_id: c.fornecedorId,
        metricas_apoio: c.metricasApoio,
      }));
      const confiancas = candidatos.flatMap((c) => confiancaDe(c.metricas_apoio) ?? []);
      return {
        data: contexto.dataReferencia,
        candidatos,
        n_registros: candidatos.length,
        menor_confianca: confiancas.length === 0 ? null : Math.min(...confiancas),
        n_suprimidos: resultado.suprimidos.length,
        ausentes: resultado.ausentes,
      };
    },
  });
}
