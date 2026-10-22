import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Executor } from "../infra/database/database.module";
import { alerta, compra, produto } from "../infra/database/schema";
import type { OrigemDado } from "../metricas/resultado-metrica";
import { RepositorioMetricasPostgres } from "../metricas/repositorio-metricas";
import type { LeituraDoPar } from "./recalculo-de-reajuste";
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
   * Roda `corpo` com uma trava por comerciante e dia: uma execução do motor de cada vez. A trava é do
   * banco e vale por toda a execução, mesmo que as consultas do corpo usem outras conexões.
   */
  comExclusao<T>(comercianteId: string, dataReferencia: string, corpo: () => Promise<T>): Promise<T>;
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
      /** Produtos sem dado para avaliar naquele tipo: seus candidatos não podem ser dados como obsoletos. */
      excluir?: ReadonlyArray<{ tipo: TipoAlerta; produtoId: string }>;
      manter: ReadonlyArray<Pick<AlertaJaTratado, "tipo" | "chave">>;
    },
  ): Promise<number>;
  /**
   * Os candidatos de `reajuste_de_custo` do dia, de `produtoIds` se informados. O motor refaz a variação
   * dos que a regra não devolveu mais (#186).
   */
  reajustesEmAberto(
    comercianteId: string,
    dataReferencia: string,
    produtoIds?: ReadonlySet<string>,
  ): Promise<AlertaGravado[]>;
  /** Leituras de custo vigentes do par produto e fornecedor até `ate` (só leitura) e origem e confiança do produto. */
  leiturasDoPar(
    comercianteId: string,
    ate: string,
    par: { produtoId: string; fornecedorId: string },
  ): Promise<{ custos: LeituraDoPar[]; produto: { origem: OrigemDado; confianca: number } }>;
  /** Marca como `obsoleto` os candidatos `ids` do comerciante. Só sai de `candidato`. */
  marcarObsoletosPorId(comercianteId: string, ids: readonly string[]): Promise<number>;
  /**
   * Troca prioridade e métricas de apoio de um candidato, só se algo mudou e só enquanto for `candidato`.
   * Devolve se a linha mudou.
   */
  atualizarCandidato(
    comercianteId: string,
    id: string,
    novo: { prioridade: Prioridade; metricasApoio: Record<string, unknown> },
  ): Promise<boolean>;
  /** Os candidatos do dia, sem ordem garantida dentro do nível: o motor ordena. */
  candidatosDoDia(comercianteId: string, dataReferencia: string): Promise<AlertaGravado[]>;
}

export const REPOSITORIO_ALERTAS = Symbol("REPOSITORIO_ALERTAS");

/**
 * Quantas execuções do motor seguram a trava ao mesmo tempo, somando todos os processos. Cada uma ocupa
 * uma conexão da transação e o corpo precisa de outras: sem teto, muitas execuções juntas esgotariam o
 * pool (10) com todas esperando conexão. O teto é do banco (vagas por `pg_try_advisory_xact_lock`), sem
 * estado em memória do processo (regra inviolável 11).
 */
const VAGAS_DE_EXECUCAO = 4;
const ESPERA_POR_VAGA_MS = 25;

const esperar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
    // O `DO UPDATE` falha se a mesma chave vier duas vezes no mesmo comando: vale a primeira da lista.
    const vistas = new Set<string>();
    const unicos = novos.filter((n) => {
      const id = `${n.tipo}|${n.chave}`;
      if (vistas.has(id)) return false;
      vistas.add(id);
      return true;
    });
    const gravados = await this.db
      .insert(alerta)
      .values(unicos.map((n) => ({ ...n, comercianteId, dataReferencia, status: "candidato" as const })))
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

  async comExclusao<T>(comercianteId: string, dataReferencia: string, corpo: () => Promise<T>): Promise<T> {
    // Sem vaga livre a transação termina sem segurar nada e tenta de novo depois: quem espera não ocupa
    // conexão. Dentro de uma Tx de quem chamou a trava vale até o commit dele (a transação aninhada é um
    // savepoint).
    for (;;) {
      const executado = await this.db.transaction(async (tx) => {
        if (!(await this.pegarVaga(tx))) return null;
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`alerta:${comercianteId}:${dataReferencia}`}))`,
        );
        return { valor: await corpo() };
      });
      if (executado) return executado.valor;
      await esperar(ESPERA_POR_VAGA_MS);
    }
  }

  private async pegarVaga(tx: Executor): Promise<boolean> {
    for (let vaga = 0; vaga < VAGAS_DE_EXECUCAO; vaga++) {
      const { rows } = await tx.execute<{ pegou: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtext(${`alerta-vaga:${vaga}`})) as pegou`,
      );
      if (rows[0]?.pegou) return true;
    }
    return false;
  }

  async marcarObsoletos(
    comercianteId: string,
    dataReferencia: string,
    escopo: {
      tipos: readonly TipoAlerta[];
      produtoIds?: ReadonlySet<string>;
      excluir?: ReadonlyArray<{ tipo: TipoAlerta; produtoId: string }>;
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
      .filter((l) => !escopo.excluir?.some((e) => e.tipo === l.tipo && e.produtoId === l.produtoId))
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

  async reajustesEmAberto(
    comercianteId: string,
    dataReferencia: string,
    produtoIds?: ReadonlySet<string>,
  ): Promise<AlertaGravado[]> {
    const linhas = await this.db
      .select()
      .from(alerta)
      .where(
        and(
          eq(alerta.comercianteId, comercianteId),
          eq(alerta.dataReferencia, dataReferencia),
          eq(alerta.status, "candidato"),
          eq(alerta.tipo, "reajuste_de_custo"),
        ),
      );
    return linhas
      .filter((l) => !produtoIds || (l.produtoId !== null && produtoIds.has(l.produtoId)))
      .map((l) => ({
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

  async leiturasDoPar(
    comercianteId: string,
    ate: string,
    par: { produtoId: string; fornecedorId: string },
  ): Promise<{ custos: LeituraDoPar[]; produto: { origem: OrigemDado; confianca: number } }> {
    const doFornecedor = (
      await new RepositorioMetricasPostgres(this.db).custosDeCompra(comercianteId, ate, par.produtoId)
    ).filter((c) => c.fornecedorId === par.fornecedorId);
    const compras = doFornecedor.length
      ? await this.db
          .select({ id: compra.id, criadoEm: compra.criadoEm })
          .from(compra)
          .where(
            and(
              eq(compra.comercianteId, comercianteId),
              inArray(compra.id, [...new Set(doFornecedor.map((c) => c.compraId))]),
            ),
          )
      : [];
    const criadaEm = new Map(compras.map((c) => [c.id, c.criadoEm]));
    const [p] = await this.db
      .select({ origem: produto.origem, confianca: produto.confianca })
      .from(produto)
      .where(and(eq(produto.comercianteId, comercianteId), eq(produto.id, par.produtoId)));
    return {
      custos: doFornecedor.flatMap((c) => {
        const compraCriadaEm = criadaEm.get(c.compraId);
        return compraCriadaEm ? [{ ...c, compraCriadaEm }] : [];
      }),
      // Produto que não aparece: confiança zero, para o recálculo nunca parecer mais seguro do que é.
      produto: { origem: p?.origem ?? "dono", confianca: p?.confianca ?? 0 },
    };
  }

  async marcarObsoletosPorId(comercianteId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const marcados = await this.db
      .update(alerta)
      .set({ status: "obsoleto" })
      .where(
        and(
          inArray(alerta.id, [...ids]),
          eq(alerta.comercianteId, comercianteId),
          eq(alerta.status, "candidato"),
        ),
      )
      .returning({ id: alerta.id });
    return marcados.length;
  }

  async atualizarCandidato(
    comercianteId: string,
    id: string,
    novo: { prioridade: Prioridade; metricasApoio: Record<string, unknown> },
  ): Promise<boolean> {
    const mudou = await this.db
      .update(alerta)
      .set({ prioridade: novo.prioridade, metricasApoio: novo.metricasApoio })
      .where(
        and(
          eq(alerta.id, id),
          eq(alerta.comercianteId, comercianteId),
          eq(alerta.status, "candidato"),
          sql`(${alerta.prioridade} is distinct from ${novo.prioridade}
            or ${alerta.metricasApoio} is distinct from ${JSON.stringify(novo.metricasApoio)}::jsonb)`,
        ),
      )
      .returning({ id: alerta.id });
    return mudou.length > 0;
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
