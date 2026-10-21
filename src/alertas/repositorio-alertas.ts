import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Executor } from "../infra/database/database.module";
import { alerta } from "../infra/database/schema";
import type { TipoAlerta, Prioridade } from "./tipos";

export interface AlertaGravado {
  id: string;
  tipo: TipoAlerta;
  chave: string;
  prioridade: Prioridade;
  dataReferencia: string;
  produtoId: string | null;
  fornecedorId: string | null;
  metricasApoio: Record<string, unknown>;
}

export interface NovoAlerta {
  tipo: TipoAlerta;
  chave: string;
  prioridade: Prioridade;
  produtoId: string | null;
  fornecedorId: string | null;
  metricasApoio: Record<string, unknown>;
}

export interface AlertaJaTratado {
  tipo: TipoAlerta;
  chave: string;
  dataReferencia: string;
}

/** Acesso do motor à tabela `alerta`. Toda consulta é do comerciante da sessão (regra inviolável 3). */
export interface RepositorioAlertas {
  /** Alertas enviados ou descartados entre `desde` (inclusive) e `ate` (exclusive). */
  jaTratados(comercianteId: string, desde: string, ate: string): Promise<AlertaJaTratado[]>;
  /** Grava como `candidato`; um alerta que já existe no dia (mesmo tipo e chave) fica como está. */
  gravarCandidatos(comercianteId: string, dataReferencia: string, novos: NovoAlerta[]): Promise<number>;
  /** Os candidatos do dia, sem ordem garantida dentro do nível: o motor ordena. */
  candidatosDoDia(comercianteId: string, dataReferencia: string): Promise<AlertaGravado[]>;
}

export const REPOSITORIO_ALERTAS = Symbol("REPOSITORIO_ALERTAS");

export class RepositorioAlertasPostgres implements RepositorioAlertas {
  constructor(private readonly db: Executor) {}

  async jaTratados(comercianteId: string, desde: string, ate: string): Promise<AlertaJaTratado[]> {
    return this.db
      .select({ tipo: alerta.tipo, chave: alerta.chave, dataReferencia: alerta.dataReferencia })
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          inArray(alerta.status, ["enviado", "descartado"]),
          gte(alerta.dataReferencia, desde),
          lt(alerta.dataReferencia, ate),
        ),
      );
  }

  async gravarCandidatos(
    comercianteId: string,
    dataReferencia: string,
    novos: NovoAlerta[],
  ): Promise<number> {
    if (novos.length === 0) return 0;
    const gravados = await this.db
      .insert(alerta)
      .values(novos.map((n) => ({ ...n, comercianteId, dataReferencia, status: "candidato" as const })))
      .onConflictDoNothing({
        target: [alerta.comercianteId, alerta.tipo, alerta.chave, alerta.dataReferencia],
      })
      .returning({ id: alerta.id });
    return gravados.length;
  }

  async candidatosDoDia(comercianteId: string, dataReferencia: string): Promise<AlertaGravado[]> {
    const linhas = await this.db
      .select()
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          eq(alerta.dataReferencia, dataReferencia),
          eq(alerta.status, "candidato"),
        ),
      )
      .orderBy(asc(alerta.prioridade));
    return linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      chave: l.chave,
      prioridade: l.prioridade as Prioridade,
      dataReferencia: l.dataReferencia,
      produtoId: l.produtoId,
      fornecedorId: l.fornecedorId,
      metricasApoio: l.metricasApoio as Record<string, unknown>,
    }));
  }
}
