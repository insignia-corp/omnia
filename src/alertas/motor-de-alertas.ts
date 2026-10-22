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
import type { AlertaGravado, AlertaJaTratado, RepositorioAlertas } from "./repositorio-alertas";
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
  /**
   * Não grava candidato cujo tipo e chave já existem em qualquer data e com qualquer status. A
   * unique do banco só segura a repetição no mesmo dia; o job pós-nota roda uma vez por documento e
   * não pode repetir o mesmo reajuste num dia seguinte. O motor diário não usa isto: o candidato de
   * ontem que não foi enviado precisa voltar a ser candidato de hoje.
   */
  semRepetirGravados?: boolean;
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
  /** Candidatos do dia que a regra deixou de disparar e viraram `obsoleto` (depois de uma correção do dono). */
  obsoletos: number;
}

export class MotorDeAlertas {
  constructor(
    private readonly metricas: MetricasService,
    private readonly alertas: RepositorioAlertas,
    private readonly limites: FonteDeLimites,
    private readonly regras: readonly RegraDeAlerta[] = REGRAS_DE_ALERTA,
  ) {}

  /**
   * Uma execução por comerciante e dia de cada vez (trava no banco): duas execuções sobrepostas, como
   * o motor diário e o job pós-nota, não podem se atropelar e deixar um número velho num candidato
   * que a outra acabou de corrigir.
   */
  executar(contexto: ContextoDoMotor, opcoes: OpcoesDoMotor = {}): Promise<ResultadoDoMotor> {
    return this.alertas.comExclusao(contexto.comercianteId, contexto.dataReferencia, () =>
      this.executarComTrava(contexto, opcoes),
    );
  }

  private async executarComTrava(
    contexto: ContextoDoMotor,
    opcoes: OpcoesDoMotor,
  ): Promise<ResultadoDoMotor> {
    const { comercianteId, dataReferencia } = contexto;
    const limites = mesclarLimites(await this.limites.limitesDoComerciante(comercianteId));
    const metricas = new MetricasDaExecucao(this.metricas, { comercianteId, dataReferencia });

    const { tipos, produtoIds, semRepetirGravados } = opcoes;
    const regras = tipos ? this.regras.filter((r) => tipos.includes(r.tipo)) : this.regras;
    const resultados = await Promise.all(
      regras.map((regra) => regra.avaliar({ comercianteId, dataReferencia, limites, metricas })),
    );
    const achados = resultados
      .flatMap((r) => r.candidatos)
      .filter((c) => !produtoIds || (c.produtoId !== null && produtoIds.has(c.produtoId)));
    const ausentes = resultados.flatMap((r) => r.ausentes);

    const tiposComJanela = Object.keys(limites.janelaSupressaoDias) as TipoAlerta[];
    const comJanela = tiposComJanela.filter((t) => (limites.janelaSupressaoDias[t] ?? 0) > 0);
    const semLimite = tiposComJanela.filter((t) => limites.janelaSupressaoDias[t] === null);
    const maiorJanela = Math.max(0, ...comJanela.map((t) => limites.janelaSupressaoDias[t] ?? 0));
    const [recentes, definitivos] = await Promise.all([
      this.alertas.jaTratados(comercianteId, {
        desde: somarDias(dataReferencia, -maiorJanela),
        ate: somarDias(dataReferencia, 1),
        tipos: comJanela,
      }),
      this.alertas.jaTratados(comercianteId, {
        desde: null,
        ate: somarDias(dataReferencia, 1),
        tipos: semLimite,
      }),
    ]);
    const tratados = [...recentes, ...definitivos];
    const jaGravados = semRepetirGravados
      ? await this.alertas.jaGravados(comercianteId, [...new Set(achados.map((c) => c.tipo))])
      : [];
    const mesmoMovimento = (t: AlertaJaTratado, c: CandidatoDeAlerta): boolean =>
      c.tipo === "reajuste_de_custo" &&
      t.tipo === "reajuste_de_custo" &&
      c.produtoId !== null &&
      t.produtoId === c.produtoId &&
      t.fornecedorId === c.fornecedorId &&
      t.metricasApoio?.custo_atual_centavos === c.metricasApoio.custo_atual_centavos &&
      t.metricasApoio?.custo_anterior_centavos === c.metricasApoio.custo_anterior_centavos &&
      diasEntre(t.dataReferencia, dataReferencia) < limites.reajusteMesmoMovimentoDias;
    /** Já enviado ou descartado dentro da janela: o alerta não precisa voltar. */
    const jaTratado = (c: CandidatoDeAlerta): boolean => {
      const janela = limites.janelaSupressaoDias[c.tipo];
      return tratados.some(
        (t) =>
          (t.tipo === c.tipo &&
            t.chave === c.chave &&
            (janela === null || diasEntre(t.dataReferencia, dataReferencia) < janela)) ||
          mesmoMovimento(t, c),
      );
    };
    const repetido = (c: CandidatoDeAlerta): boolean =>
      jaGravados.some((g) => g.tipo === c.tipo && g.chave === c.chave);

    const suprimidos = achados.filter((c) => jaTratado(c) || repetido(c));
    const ordenados = achados
      .filter((c) => !jaTratado(c) && !repetido(c))
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

    // O candidato do dia que a regra não dispara mais (depois de uma correção do dono) vira obsoleto.
    // Só nas regras que avaliaram com dado: sem dado (ausente) não dá para dizer que deixou de valer. Um
    // candidato que continua valendo mas foi só barrado pela repetição do job fica como está.
    const avaliados = regras
      .filter((_, i) => resultados[i]!.ausentes.length === 0 || resultados[i]!.produtosSemDado !== undefined)
      .map((r) => r.tipo);
    // A ausência de um produto vale só para o tipo da regra que não o avaliou.
    const semDado = regras.flatMap((r, i) =>
      (resultados[i]!.produtosSemDado ?? []).map((produtoId) => ({ tipo: r.tipo, produtoId })),
    );
    const obsoletos = await this.alertas.marcarObsoletos(comercianteId, dataReferencia, {
      tipos: avaliados,
      ...(produtoIds ? { produtoIds } : {}),
      ...(semDado.length > 0 ? { excluir: semDado } : {}),
      manter: achados.filter((c) => !jaTratado(c)).map((c) => ({ tipo: c.tipo, chave: c.chave })),
    });
    return {
      candidatos: ordenarGravados(await this.alertas.candidatosDoDia(comercianteId, dataReferencia)),
      gravados,
      suprimidos,
      ausentes,
      obsoletos,
    };
  }
}
