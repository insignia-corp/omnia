import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, isNull, or } from "drizzle-orm";
import { DB, type Db } from "../../infra/database/database.module";
import { alerta } from "../../infra/database/schema";
import type { DecisaoAlerta } from "./tipos";

export const FONTE_DECISOES_ALERTA = Symbol("FONTE_DECISOES_ALERTA");

/**
 * Ponto de extensão dos bastidores: candidatos a alerta, a escolha do agente e a justificativa.
 * A implementação padrão lê a tabela `alerta`, que o motor de alertas (plano A) e o agente (plano B)
 * preenchem. Quem quiser outra origem troca o provider; a tela não muda.
 */
export interface FonteDecisoesAlerta {
  listar(comercianteId: string, filtro: { execucaoIds: string[]; desde: Date }): Promise<DecisaoAlerta[]>;
}

@Injectable()
export class FonteDecisoesAlertaDoBanco implements FonteDecisoesAlerta {
  constructor(@Inject(DB) private readonly db: Db) {}

  async listar(
    comercianteId: string,
    filtro: { execucaoIds: string[]; desde: Date },
  ): Promise<DecisaoAlerta[]> {
    const ligado = filtro.execucaoIds.length > 0 ? inArray(alerta.execucaoId, filtro.execucaoIds) : undefined;
    const linhas = await this.db
      .select()
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          or(ligado, and(isNull(alerta.execucaoId), gte(alerta.criadoEm, filtro.desde))),
        ),
      )
      .orderBy(desc(alerta.criadoEm))
      .limit(100);
    return linhas.map((l) => ({
      alerta_id: l.id,
      tipo: l.tipo,
      prioridade: l.prioridade,
      status: l.status,
      data_referencia: l.dataReferencia,
      chave: l.chave,
      metricas_apoio: l.metricasApoio,
      justificativa: l.justificativa,
      execucao_id: l.execucaoId,
    }));
  }
}
