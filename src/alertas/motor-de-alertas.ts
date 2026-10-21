/**
 * Motor de alertas (issues #43 e #44): roda as regras sobre as métricas do comerciante, ordena os
 * candidatos, suprime o que já foi enviado ou descartado dentro da janela e grava o resto como
 * `candidato`. Só lista candidatos; quem escolhe o que vai na mensagem é o agente. É idempotente:
 * rodar de novo no mesmo dia não cria nem altera nada.
 */
import { diasEntre, somarDias } from "../lib/datas/datas";
import { MetricasService } from "../metricas/metricas.service";
import { mesclarLimites, type FonteDeLimites } from "./limites";
import { compararCandidatos, ordenarGravados, prioridadeDe } from "./prioridade";
import { MetricasDaExecucao, type CandidatoDeAlerta, type MotivoAusente, type RegraDeAlerta } from "./regra";
import type { AlertaGravado, RepositorioAlertas } from "./repositorio-alertas";
import type { TipoAlerta } from "./tipos";
import { REGRAS_DE_ALERTA } from "./regras";
import type { TipoAlerta } from "./tipos";

export interface ContextoDoMotor {
  /** Vem da sessão, nunca do modelo. */
  comercianteId: string;
  dataReferencia: string;
}

export interface OpcoesDoMotor {
  /** Roda só as regras destes tipos (o job de reajuste roda só a de reajuste). */
  tipos?: readonly TipoAlerta[];
  /** Grava só candidatos destes produtos (os itens da nota que acabou de ser processada). */
  produtoIds?: ReadonlySet<string>;
}

export interface ResultadoDoMotor {
  /** Todos os candidatos do dia no banco, do mais ao menos importante. */
  candidatos: AlertaGravado[];
  /** Quantos candidatos esta execução gravou (zero numa repetição do mesmo dia). */
  gravados: number;
  /** Candidatos que as regras acharam mas a janela de supressão barrou. */
  suprimidos: CandidatoDeAlerta[];
  /** Regras que ficaram sem dado: sem candidato, nunca zero. */
  ausentes: MotivoAusente[];
}

export class MotorDeAlertas {
  constructor(
    private readonly metricas: MetricasService,
    private readonly alertas: RepositorioAlertas,
    private readonly limites: FonteDeLimites,
    private readonly regras: readonly RegraDeAlerta[] = REGRAS_DE_ALERTA,
  ) {}

  async executar(contexto: ContextoDoMotor, opcoes: OpcoesDoMotor = {}): Promise<ResultadoDoMotor> {
    const { comercianteId, dataReferencia } = contexto;
    const limites = mesclarLimites(await this.limites.limitesDoComerciante(comercianteId));
    const metricas = new MetricasDaExecucao(this.metricas, { comercianteId, dataReferencia });

    const { tipos, produtoIds } = opcoes;
    const regras = tipos ? this.regras.filter((r) => tipos.includes(r.tipo)) : this.regras;
    const resultados = await Promise.all(
      regras.map((regra) => regra.avaliar({ comercianteId, dataReferencia, limites, metricas })),
    );
    const achados = resultados
      .flatMap((r) => r.candidatos)
      .filter((c) => !produtoIds || (c.produtoId !== null && produtoIds.has(c.produtoId)));
    const ausentes = resultados.flatMap((r) => r.ausentes);

    const tipos = Object.keys(limites.janelaSupressaoDias) as TipoAlerta[];
    const comJanela = tipos.filter((t) => (limites.janelaSupressaoDias[t] ?? 0) > 0);
    const semLimite = tipos.filter((t) => limites.janelaSupressaoDias[t] === null);
    const maiorJanela = Math.max(0, ...comJanela.map((t) => limites.janelaSupressaoDias[t] ?? 0));
    const [recentes, definitivos] = await Promise.all([
      this.alertas.jaTratados(comercianteId, {
        desde: somarDias(dataReferencia, -maiorJanela),
        ate: dataReferencia,
        tipos: comJanela,
      }),
      this.alertas.jaTratados(comercianteId, { desde: null, ate: dataReferencia, tipos: semLimite }),
    ]);
    const tratados = [...recentes, ...definitivos];
    const barrado = (c: CandidatoDeAlerta): boolean => {
      const janela = limites.janelaSupressaoDias[c.tipo];
      return tratados.some(
        (t) =>
          t.tipo === c.tipo &&
          t.chave === c.chave &&
          (janela === null || diasEntre(t.dataReferencia, dataReferencia) < janela),
      );
    };

    const suprimidos = achados.filter(barrado);
    const ordenados = achados
      .filter((c) => !barrado(c))
      .map((c) => ({ ...c, prioridade: prioridadeDe(c, limites) }))
      .sort(compararCandidatos);

    const gravados = await this.alertas.gravarCandidatos(
      comercianteId,
      dataReferencia,
      ordenados.map((c) => ({
        tipo: c.tipo,
        chave: c.chave,
        prioridade: c.prioridade,
        produtoId: c.produtoId,
        fornecedorId: c.fornecedorId,
        metricasApoio: {
          ...c.metricasApoio,
          impacto_centavos: c.impactoCentavos,
          menor_confianca: c.confianca,
        },
      })),
    );
    return {
      candidatos: ordenarGravados(await this.alertas.candidatosDoDia(comercianteId, dataReferencia)),
      gravados,
      suprimidos,
      ausentes,
    };
  }
}
