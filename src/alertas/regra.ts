/**
 * Contrato das regras do motor de alertas (issue #43). Uma regra lê métricas já calculadas e decide
 * se viram candidato; nunca calcula número. Dado ausente não é zero: a regra não gera candidato e
 * o motivo volta em `ausentes`, para o agente poder perguntar ao dono.
 */
import {
  calcularEspacoParaSubirPreco,
  type ProdutoComEspacoParaSubirPreco,
} from "../metricas/espaco-para-subir-preco";
import type { ProdutoParado } from "../metricas/estoque-parado";
import type { GastoForaDoPadrao } from "../metricas/gasto-fora-do-padrao";
import type { Giro } from "../metricas/giro";
import type { ContextoMetricas, MargemDeProduto, MetricasService } from "../metricas/metricas.service";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "../metricas/resultado-metrica";
import type { TicketMedio } from "../metricas/ticket-medio";
import type { VariacaoDeCusto } from "../metricas/variacao-de-custo";
import type { LimitesDeAlerta } from "./limites";
import type { TipoAlerta } from "./tipos";

/** Fonte dos números de um candidato: a procedência da métrica que o sustenta. */
export interface FonteDoCandidato {
  periodo: { inicio: string; fim: string };
  n_registros: number;
  menor_confianca: number | null;
  origens: string[];
}

export type MetricasDeApoio = Record<string, string | number | null | string[] | object>;

export interface CandidatoDeAlerta {
  tipo: TipoAlerta;
  /** Com a data, distingue candidatos do mesmo tipo (idempotência e supressão). */
  chave: string;
  produtoId: string | null;
  fornecedorId: string | null;
  metricasApoio: MetricasDeApoio;
  /** Impacto estimado em centavos, calculado em código; nulo quando não há como medir. */
  impactoCentavos: number | null;
  /** A menor confiança dos dados que sustentam o candidato; nula quando a métrica não informa. */
  confianca: number | null;
}

export interface MotivoAusente {
  tipo: TipoAlerta;
  codigo: string;
  motivo: string;
}

export interface ResultadoDaRegra {
  candidatos: CandidatoDeAlerta[];
  ausentes: MotivoAusente[];
  /**
   * Presente quando a ausência de dado é só de alguns produtos: a regra avaliou os demais, e o motor
   * só deixa de marcar como obsoletos os candidatos destes. Sem isto, qualquer `ausentes` quer dizer
   * que a regra inteira ficou sem dado.
   */
  produtosSemDado?: string[];
}

export interface RegraDeAlerta {
  tipo: TipoAlerta;
  avaliar(contexto: ContextoDasRegras): Promise<ResultadoDaRegra>;
}

export interface ContextoDasRegras {
  comercianteId: string;
  dataReferencia: string;
  limites: LimitesDeAlerta;
  metricas: MetricasDaExecucao;
}

/**
 * As métricas de uma execução do motor. Cada uma é calculada uma vez, mesmo que várias regras a
 * usem (margem e espaço para subir preço leem as mesmas margens e o mesmo giro). O objeto vive só
 * durante a execução: nada fica em memória entre uma execução e outra.
 */
export class MetricasDaExecucao {
  private readonly cache = new Map<string, Promise<unknown>>();

  constructor(
    private readonly servico: MetricasService,
    private readonly contexto: ContextoMetricas,
  ) {}

  private uma<T>(nome: string, calcular: () => Promise<T>): Promise<T> {
    const guardada = this.cache.get(nome);
    if (guardada) return guardada as Promise<T>;
    const nova = calcular();
    this.cache.set(nome, nova);
    return nova;
  }

  margens(): Promise<MargemDeProduto[]> {
    return this.uma("margens", () => this.servico.margensDosProdutos(this.contexto));
  }
  variacoesDeCusto(): Promise<ResultadoMetrica<VariacaoDeCusto[]>> {
    return this.uma("variacoes", () => this.servico.variacoesDeCusto(this.contexto));
  }
  giro(): Promise<ResultadoMetrica<Giro> | DadoAusente> {
    return this.uma("giro", () => this.servico.giro(this.contexto));
  }
  estoqueParado(): Promise<ResultadoMetrica<ProdutoParado[]>> {
    return this.uma("estoque", () => this.servico.estoqueParado(this.contexto));
  }
  ticketMedio(): Promise<ResultadoMetrica<TicketMedio> | DadoAusente> {
    return this.uma("ticket", () => this.servico.ticketMedio(this.contexto));
  }
  gastoForaDoPadrao(): Promise<ResultadoMetrica<GastoForaDoPadrao> | DadoAusente> {
    return this.uma("gasto", () => this.servico.gastoForaDoPadrao(this.contexto));
  }
  async espacoParaSubirPreco(): Promise<ResultadoMetrica<ProdutoComEspacoParaSubirPreco[]> | DadoAusente> {
    return this.uma("espaco", async () => {
      const [giro, margens] = await Promise.all([this.giro(), this.margens()]);
      if (ehDadoAusente(giro)) return giro;
      return calcularEspacoParaSubirPreco({ giro, margens });
    });
  }
}

export const fonteDe = (r: ResultadoMetrica<unknown>): FonteDoCandidato => ({
  periodo: r.periodo,
  n_registros: r.n_registros,
  menor_confianca: r.menor_confianca,
  origens: r.origens,
});
