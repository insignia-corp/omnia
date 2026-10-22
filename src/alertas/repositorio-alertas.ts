import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
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
  /** Para reconhecer o mesmo reajuste sob outra chave (o custo novo e o anterior ficam em `metricasApoio`). */
  produtoId?: string | null;
  fornecedorId?: string | null;
  metricasApoio?: Record<string, unknown>;
}

/** Acesso do motor à tabela `alerta`. Toda consulta é do comerciante da sessão (regra inviolável 3). */
export interface RepositorioAlertas {
  /**
   * Alertas dos `tipos` enviados ou descartados antes de `ate` (exclusive) e a partir de `desde`
   * (inclusive); `desde` nulo não limita a idade.
   */
  jaTratados(
    comercianteId: string,
    filtro: { desde: string | null; ate: string; tipos: readonly TipoAlerta[] },
  ): Promise<AlertaJaTratado[]>;
  /** Tipo e chave dos alertas dos `tipos` já gravados em qualquer data e com qualquer status. */
  jaGravados(
    comercianteId: string,
    tipos: readonly TipoAlerta[],
  ): Promise<Array<Pick<AlertaJaTratado, "tipo" | "chave">>>;
  /**
   * Grava como `candidato`. Um alerta que já existe no dia (mesmo tipo e chave) como `candidato` ou
   * `obsoleto` é atualizado (prioridade e métricas de apoio, e volta a `candidato`) só se algo mudou;
   * `enviado` e `descartado` nunca são tocados. Devolve quantas linhas foram criadas ou mudaram.
   */
  gravarCandidatos(comercianteId: string, dataReferencia: string, novos: NovoAlerta[]): Promise<number>;
  /**
   * Marca como `obsoleto` os candidatos do dia dos `tipos` (e dos `produtoIds`, se informados) que não
   * estão em `manter`: a regra deixou de disparar depois de uma correção do dono. Só sai de `candidato`.
   */
  marcarObsoletos(
    comercianteId: string,
    dataReferencia: string,
    escopo: {
      tipos: readonly TipoAlerta[];
      produtoIds?: ReadonlySet<string>;
      /** Produtos sem dado para avaliar: seus candidatos não podem ser dados como obsoletos. */
      excluirProdutoIds?: ReadonlySet<string>;
      manter: ReadonlyArray<Pick<AlertaJaTratado, "tipo" | "chave">>;
    },
  ): Promise<number>;
  /** Os candidatos do dia, sem ordem garantida dentro do nível: o motor ordena. */
  candidatosDoDia(comercianteId: string, dataReferencia: string): Promise<AlertaGravado[]>;
}

export const REPOSITORIO_ALERTAS = Symbol("REPOSITORIO_ALERTAS");

export class RepositorioAlertasPostgres implements RepositorioAlertas {
  constructor(private readonly db: Executor) {}

  async jaTratados(
    comercianteId: string,
    filtro: { desde: string | null; ate: string; tipos: readonly TipoAlerta[] },
  ): Promise<AlertaJaTratado[]> {
    if (filtro.tipos.length === 0) return [];
    const linhas = await this.db
      .select({
        tipo: alerta.tipo,
        chave: alerta.chave,
        dataReferencia: alerta.dataReferencia,
        produtoId: alerta.produtoId,
        fornecedorId: alerta.fornecedorId,
        metricasApoio: alerta.metricasApoio,
      })
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          inArray(alerta.tipo, [...filtro.tipos]),
          inArray(alerta.status, ["enviado", "descartado"]),
          ...(filtro.desde === null ? [] : [gte(alerta.dataReferencia, filtro.desde)]),
          lt(alerta.dataReferencia, filtro.ate),
        ),
      );
    return linhas.map((l) => ({ ...l, metricasApoio: l.metricasApoio as Record<string, unknown> }));
  }

  async jaGravados(
    comercianteId: string,
    tipos: readonly TipoAlerta[],
  ): Promise<Array<Pick<AlertaJaTratado, "tipo" | "chave">>> {
    if (tipos.length === 0) return [];
    return this.db
      .selectDistinct({ tipo: alerta.tipo, chave: alerta.chave })
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          inArray(alerta.tipo, [...tipos]),
          // `obsoleto` não conta: a regra deixou de disparar e pode voltar a disparar.
          inArray(alerta.status, ["candidato", "enviado", "descartado"]),
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
      .onConflictDoUpdate({
        target: [alerta.comercianteId, alerta.tipo, alerta.chave, alerta.dataReferencia],
        set: {
          status: "candidato",
          prioridade: sql`excluded.prioridade`,
          metricasApoio: sql`excluded.metricas_apoio`,
          produtoId: sql`excluded.produto_id`,
          fornecedorId: sql`excluded.fornecedor_id`,
        },
        // Só candidato e obsoleto se atualizam, e só quando algo mudou: repetir com os mesmos dados não
        // altera nada. Enviado e descartado nunca voltam atrás.
        setWhere: sql`${alerta.status} in ('candidato', 'obsoleto') and (
          ${alerta.status} = 'obsoleto'
          or ${alerta.prioridade} is distinct from excluded.prioridade
          or ${alerta.metricasApoio} is distinct from excluded.metricas_apoio)`,
      })
      .returning({ id: alerta.id });
    return gravados.length;
  }

  async marcarObsoletos(
    comercianteId: string,
    dataReferencia: string,
    escopo: {
      tipos: readonly TipoAlerta[];
      produtoIds?: ReadonlySet<string>;
      excluirProdutoIds?: ReadonlySet<string>;
      manter: ReadonlyArray<Pick<AlertaJaTratado, "tipo" | "chave">>;
    },
  ): Promise<number> {
    if (escopo.tipos.length === 0) return 0;
    const doDia = await this.db
      .select({ id: alerta.id, tipo: alerta.tipo, chave: alerta.chave, produtoId: alerta.produtoId })
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          eq(alerta.dataReferencia, dataReferencia),
          eq(alerta.status, "candidato"),
          inArray(alerta.tipo, [...escopo.tipos]),
        ),
      );
    const vivos = new Set(escopo.manter.map((m) => `${m.tipo}|${m.chave}`));
    const ids = doDia
      .filter((l) => !vivos.has(`${l.tipo}|${l.chave}`))
      .filter((l) => !escopo.produtoIds || (l.produtoId !== null && escopo.produtoIds.has(l.produtoId)))
      .filter((l) => l.produtoId === null || !escopo.excluirProdutoIds?.has(l.produtoId))
      .map((l) => l.id);
    if (ids.length === 0) return 0;
    const marcados = await this.db
      .update(alerta)
      .set({ status: "obsoleto" })
      .where(
        and(inArray(alerta.id, ids), eq(alerta.comercianteId, comercianteId), eq(alerta.status, "candidato")),
      )
      .returning({ id: alerta.id });
    return marcados.length;
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
