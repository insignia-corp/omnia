import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { CicloDoAlerta } from "../../alertas/ciclo-do-alerta";
import { ENV } from "../../config/config.module";
import type { Env } from "../../config/env";
import { DB, type Db } from "../../infra/database/database.module";
import { comerciante } from "../../infra/database/schema";
import { CaixaMensagens } from "../caixa-mensagens";
import { PORTA_AGENTE, type PortaAgente } from "../porta-agente";
import { dataLocal, minutosDoDia, RELOGIO, type Relogio } from "../relogio";
import { FONTE_RELATORIO, type FonteRelatorio } from "./fonte-relatorio";
import { emSilencio } from "./horario-silencio";

export type ResultadoRelatorio = "enviada" | "duplicada" | "silencio" | "ja_enviada_hoje" | "sem_comerciante";

export interface JobRelatorioDiario {
  comercianteId: string;
  /** Data local "AAAA-MM-DD" a que o relatório se refere; faz parte da chave de idempotência. */
  data: string;
}

export const chaveRelatorio = (j: JobRelatorioDiario) => `relatorio_${j.comercianteId}_${j.data}`;

/**
 * Relatório diário proativo (issue #64, regra inviolável 9): chave comerciante + data e no máximo
 * uma mensagem proativa por dia. Quem garante é o banco (`CaixaMensagens.enviarProativa`); os
 * testes antes dele só poupam uma chamada ao modelo.
 */
@Injectable()
export class RelatorioDiarioService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(RELOGIO) private readonly relogio: Relogio,
    @Inject(PORTA_AGENTE) private readonly agente: PortaAgente,
    @Inject(FONTE_RELATORIO) private readonly fonte: FonteRelatorio,
    private readonly caixa: CaixaMensagens,
    private readonly ciclo: CicloDoAlerta,
  ) {}

  private readonly log = new Logger(RelatorioDiarioService.name);

  emSilencioAgora(): boolean {
    const minutos = minutosDoDia(this.relogio.agora(), this.env.FUSO_HORARIO);
    return emSilencio(minutos, { inicio: this.env.SILENCIO_INICIO, fim: this.env.SILENCIO_FIM });
  }

  /** Data local de agora: é nela, e não na do job, que vale o limite de uma proativa por dia. */
  private hoje(): string {
    return dataLocal(this.relogio.agora(), this.env.FUSO_HORARIO);
  }

  /**
   * `job.data` identifica o relatório (chave de idempotência e data de referência do agente). Um job
   * adiado pelo silêncio pode ser enviado no dia seguinte, e então ocupa o limite do dia do envio.
   * Devolve `silencio` quando a janela começou, antes ou durante a chamada ao modelo: o worker adia o job.
   */
  async processar(job: JobRelatorioDiario): Promise<ResultadoRelatorio> {
    if (this.emSilencioAgora()) return "silencio";
    if (await this.caixa.jaTemProativa(job.comercianteId, this.hoje())) {
      // Um job reentregue depois de uma queda entre o envio e a marcação recupera os alertas do dia.
      await this.reconciliarAlertas(job.comercianteId);
      return "ja_enviada_hoje";
    }

    const [dono] = await this.db
      .select({ nome: comerciante.nome })
      .from(comerciante)
      .where(eq(comerciante.id, job.comercianteId))
      .limit(1);
    if (!dono) return "sem_comerciante";

    const contexto = {
      comercianteId: job.comercianteId,
      nomeComercio: dono.nome,
      dataReferencia: job.data,
    };
    const resposta = await this.agente.executar({
      contexto,
      gatilho: "relatorio_diario",
      entrada: await this.fonte.entrada(contexto),
    });
    // A chamada ao modelo pode atravessar o início do silêncio: reconfere logo antes de entregar.
    if (this.emSilencioAgora()) return "silencio";
    const resultado = await this.caixa.enviarProativa({
      comercianteId: job.comercianteId,
      texto: resposta.mensagem,
      execucaoId: resposta.execucaoId,
      dataEnvio: this.hoje(),
      chave: chaveRelatorio(job),
    });
    if (resultado === "enviada" && resposta.execucaoId) {
      await this.marcarAlertasEnviados(job.comercianteId, resposta.execucaoId);
    }
    return resultado;
  }

  private async reconciliarAlertas(comercianteId: string): Promise<void> {
    try {
      await this.ciclo.reconciliar(comercianteId, this.hoje(), this.relogio.agora());
    } catch (e) {
      this.log.error(
        `Não reconciliou os alertas enviados de ${this.hoje()}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /**
   * Depois da entrega, os alertas que o agente escolheu passam a `enviado` (issue #155), o que liga
   * a supressão de 7 dias. A mensagem já saiu: falha aqui é registrada e nunca desfaz o envio.
   */
  private async marcarAlertasEnviados(comercianteId: string, execucaoId: string): Promise<void> {
    try {
      await this.ciclo.marcarEnviados(comercianteId, execucaoId, this.relogio.agora());
    } catch (e) {
      this.log.error(
        `Não marcou os alertas como enviados na execução ${execucaoId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
