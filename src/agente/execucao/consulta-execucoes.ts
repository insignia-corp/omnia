import { and, asc, desc, eq, gte, lte, ne, sql } from "drizzle-orm";
import type { Db } from "../../infra/database/database.module";
import { chamadaFerramenta, execucaoAgente } from "../../infra/database/schema";
import type { ChamadaRegistrada, ExecucaoRegistrada, GatilhoRegistrado } from "./registro-execucoes";

/** Fuso do dono: o dia da métrica é o dia no Brasil, não em UTC. */
/** Literal e não parâmetro: o PostgreSQL só aceita agrupar por uma expressão idêntica à do select. */
const FUSO = sql.raw("'America/Sao_Paulo'");

export interface ExecucaoDetalhada extends ExecucaoRegistrada {
  id: string;
  criadoEm: Date;
}

export interface ResumoExecucao {
  id: string;
  gatilho: GatilhoRegistrado;
  resultado: ExecucaoRegistrada["resultado"];
  modelo: string;
  bloqueios: number;
  custoEstimadoMicrodolares: number;
  latenciaMs: number;
  criadoEm: Date;
}

/** Degradação do verificador (edital 9.4): quanto o modelo precisou ser corrigido, dia a dia. */
export interface BloqueioPorDia {
  /** AAAA-MM-DD no fuso do dono. */
  data: string;
  execucoes: number;
  /** Execuções em que o verificador barrou pelo menos uma resposta. */
  comBloqueio: number;
  /** Execuções que terminaram no fallback do verificador (o dono recebeu a mensagem segura). */
  fallbacksVerificador: number;
  /** `comBloqueio` sobre `execucoes`, em pontos-base (inteiro; 10000 = 100%). */
  taxaBloqueioBps: number;
}

/** Leitura do registro de execuções, sempre filtrada pelo comerciante da sessão (regra inviolável 3). */
export interface ConsultaExecucoes {
  /** Uma execução com as chamadas de ferramenta em ordem; `null` se não existe ou é de outro comerciante. */
  buscar(comercianteId: string, execucaoId: string): Promise<ExecucaoDetalhada | null>;
  /** Mais recentes primeiro. */
  listar(comercianteId: string, opcoes?: { limite?: number }): Promise<ResumoExecucao[]>;
  /** Só as execuções do Analista: a extração de notas não passa pelo verificador. */
  bloqueioPorDia(comercianteId: string, periodo: { de: string; ate: string }): Promise<BloqueioPorDia[]>;
}

export const CONSULTA_EXECUCOES = Symbol("CONSULTA_EXECUCOES");

const LIMITE_PADRAO = 20;
const LIMITE_MAXIMO = 100;

export class ConsultaExecucoesPostgres implements ConsultaExecucoes {
  constructor(private readonly db: Db) {}

  async buscar(comercianteId: string, execucaoId: string): Promise<ExecucaoDetalhada | null> {
    const [e] = await this.db
      .select()
      .from(execucaoAgente)
      .where(and(eq(execucaoAgente.id, execucaoId), eq(execucaoAgente.comercianteId, comercianteId)));
    if (!e) return null;
    const linhas = await this.db
      .select()
      .from(chamadaFerramenta)
      .where(and(eq(chamadaFerramenta.execucaoId, e.id), eq(chamadaFerramenta.comercianteId, comercianteId)))
      .orderBy(asc(chamadaFerramenta.ordem));
    const chamadas: ChamadaRegistrada[] = linhas.map((c) => ({
      ordem: c.ordem,
      ferramenta: c.ferramenta,
      entrada: c.entrada,
      saida: c.saida,
      erro: c.erro,
      menorConfianca: c.menorConfianca,
      latenciaMs: c.latenciaMs,
    }));
    return {
      id: e.id,
      criadoEm: e.criadoEm,
      comercianteId: e.comercianteId,
      gatilho: e.gatilho,
      entrada: e.entrada,
      modelo: e.modelo,
      versaoPrompt: e.versaoPrompt,
      resultado: e.resultado,
      mensagemFinal: e.mensagemFinal,
      iteracoes: e.iteracoes,
      bloqueios: e.detalhesVerificador as ExecucaoRegistrada["bloqueios"],
      tokensEntrada: e.tokensEntrada,
      tokensSaida: e.tokensSaida,
      tokensCacheLeitura: e.tokensCacheLeitura,
      custoEstimadoMicrodolares: e.custoEstimadoMicrodolares,
      latenciaMs: e.latenciaMs,
      erro: e.erro,
      chamadas,
    };
  }

  async listar(comercianteId: string, opcoes: { limite?: number } = {}): Promise<ResumoExecucao[]> {
    const limite = Math.min(Math.max(opcoes.limite ?? LIMITE_PADRAO, 1), LIMITE_MAXIMO);
    const linhas = await this.db
      .select()
      .from(execucaoAgente)
      .where(eq(execucaoAgente.comercianteId, comercianteId))
      .orderBy(desc(execucaoAgente.criadoEm))
      .limit(limite);
    return linhas.map((e) => ({
      id: e.id,
      gatilho: e.gatilho,
      resultado: e.resultado,
      modelo: e.modelo,
      bloqueios: e.bloqueiosVerificador,
      custoEstimadoMicrodolares: e.custoEstimadoMicrodolares,
      latenciaMs: e.latenciaMs,
      criadoEm: e.criadoEm,
    }));
  }

  async bloqueioPorDia(
    comercianteId: string,
    periodo: { de: string; ate: string },
  ): Promise<BloqueioPorDia[]> {
    const dia = sql<string>`(${execucaoAgente.criadoEm} at time zone ${FUSO})::date`;
    const linhas = await this.db
      .select({
        data: sql<string>`to_char(${dia}, 'YYYY-MM-DD')`,
        execucoes: sql<number>`count(*)::int`,
        comBloqueio: sql<number>`count(*) filter (where ${execucaoAgente.bloqueiosVerificador} > 0)::int`,
        fallbacks: sql<number>`count(*) filter (where ${execucaoAgente.resultado} = 'fallback_verificador')::int`,
      })
      .from(execucaoAgente)
      .where(
        and(
          eq(execucaoAgente.comercianteId, comercianteId),
          ne(execucaoAgente.gatilho, "extracao_nota"),
          gte(dia, periodo.de),
          lte(dia, periodo.ate),
        ),
      )
      .groupBy(dia)
      .orderBy(asc(dia));
    return linhas.map((l) => ({
      data: l.data,
      execucoes: l.execucoes,
      comBloqueio: l.comBloqueio,
      fallbacksVerificador: l.fallbacks,
      taxaBloqueioBps: Math.round((l.comBloqueio * 10_000) / l.execucoes),
    }));
  }
}
