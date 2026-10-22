import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { Executor } from "../infra/database/database.module";
import { alerta } from "../infra/database/schema";
import { compararCustos } from "../metricas/dados-de-metricas";
import { razaoEmBps } from "../metricas/pontos-base";
import { RepositorioMetricasPostgres } from "../metricas/repositorio-metricas";
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
      /** Limite do reajuste (pontos-base): um reajuste cuja alta continua acima dele não vira obsoleto por ter sido sucedido. */
      reajusteLimiteBps?: number;
    },
  ): Promise<number>;
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
      /** Limite do reajuste (pontos-base): um reajuste cuja alta continua acima dele não vira obsoleto por ter sido sucedido. */
      reajusteLimiteBps?: number;
    },
  ): Promise<number> {
    if (escopo.tipos.length === 0) return 0;
    const doDia = await this.db
      .select({
        id: alerta.id,
        tipo: alerta.tipo,
        chave: alerta.chave,
        produtoId: alerta.produtoId,
        fornecedorId: alerta.fornecedorId,
        metricasApoio: alerta.metricasApoio,
      })
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
    const aposFiltros = doDia
      .filter((l) => !vivos.has(`${l.tipo}|${l.chave}`))
      .filter((l) => !escopo.produtoIds || (l.produtoId !== null && escopo.produtoIds.has(l.produtoId)))
      .filter((l) => !escopo.excluir?.some((e) => e.tipo === l.tipo && e.produtoId === l.produtoId));
    const ids: string[] = [];
    for (const l of aposFiltros) {
      if (
        escopo.reajusteLimiteBps !== undefined &&
        (await this.altaDaCompraAindaVale(comercianteId, dataReferencia, escopo.reajusteLimiteBps, l))
      )
        continue;
      ids.push(l.id);
    }
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

  /**
   * Um reajuste cuja compra foi sucedida por outra do mesmo produto e fornecedor (uma segunda nota no
   * mesmo dia, por exemplo) não foi refutado: a regra só olha a compra atual do par e deixa de enxergar a
   * alta. Aqui a variação da própria compra do alerta é recalculada com as leituras vigentes, na ordem da
   * métrica (`compararCustos`): a anterior é a última leitura de outra compra que vem antes dela. Se a alta
   * ainda passa do limite, o alerta fica como candidato; se a correção do dono (de qualquer das notas) a
   * desfez, ele vira obsoleto.
   */
  private async altaDaCompraAindaVale(
    comercianteId: string,
    dataReferencia: string,
    limiteBps: number,
    l: { tipo: TipoAlerta; produtoId: string | null; fornecedorId: string | null; metricasApoio: unknown },
  ): Promise<boolean> {
    if (l.tipo !== "reajuste_de_custo" || l.produtoId === null || l.fornecedorId === null) return false;
    const compraId = (l.metricasApoio as Record<string, unknown>).compra_atual_id;
    if (typeof compraId !== "string") return false;
    const custos = (
      await new RepositorioMetricasPostgres(this.db).custosDeCompra(
        comercianteId,
        dataReferencia,
        l.produtoId,
      )
    )
      .filter((c) => c.fornecedorId === l.fornecedorId)
      .sort(compararCustos);
    const propria = custos.findLastIndex((c) => c.compraId === compraId);
    if (propria < 0) return false;
    const anterior = custos.slice(0, propria).findLast((c) => c.compraId !== compraId);
    if (!anterior) return false;
    const variacao = razaoEmBps(
      custos[propria]!.custoUnitarioCentavos - anterior.custoUnitarioCentavos,
      anterior.custoUnitarioCentavos,
    );
    return variacao !== null && variacao > limiteBps;
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
