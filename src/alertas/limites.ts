/**
 * Limites do motor de alertas (issue #43). Os valores iniciais vêm das constantes `PARAMETROS_*`
 * de src/metricas, que são o dono deles; cada comerciante pode sobrepor os seus pela
 * `FonteDeLimites`. O motor só relê os números que a métrica já calculou contra o limite do
 * comerciante: janelas e tamanho de ranking continuam os da métrica.
 */
import type { TipoAlerta } from "./tipos";
import { PARAMETROS_ESTOQUE_PARADO } from "../metricas/estoque-parado";
import { PARAMETROS_GASTO_FORA_DO_PADRAO } from "../metricas/gasto-fora-do-padrao";
import { PARAMETROS_TICKET_MEDIO } from "../metricas/ticket-medio";
import { PARAMETROS_VARIACAO_CUSTO } from "../metricas/variacao-de-custo";

export interface LimitesDeAlerta {
  /** Reajuste: variação de custo acima deste valor, em pontos-base. */
  reajusteLimiteBps: number;
  /** Reajuste: a compra atual tem no máximo estes dias na data de referência. */
  reajusteJanelaDias: number;
  /**
   * Reajuste: um alerta já enviado ou descartado do mesmo produto e fornecedor, com o mesmo custo
   * novo e o mesmo custo anterior, vale como o mesmo reajuste por esta quantidade de dias, mesmo sob
   * outra chave (a correção do dono pode trocar a compra atual). Só dentro da janela: o mesmo
   * movimento de preço meses depois é outro reajuste.
   */
  reajusteMesmoMovimentoDias: number;
  /** Giro em alta: alta sobre a média semanal acima deste valor, em pontos-base. */
  giroAltaMinimaBps: number;
  /** Estoque parado: mais dias sem venda que isto. Só vale a partir de 30 dias, o corte da métrica. */
  estoqueParadoLimiteDias: number;
  /** Ticket médio: queda de pelo menos isto contra a média dos 28 dias, em pontos-base. */
  ticketQuedaLimiteBps: number;
  /** Gasto fora do padrão: desvio robusto acima disto. */
  gastoLimiteDesvio: number;
  /** Prioridade 1 a partir deste impacto estimado, em centavos. */
  prioridade1MinCentavos: number;
  /** Prioridade 2 a partir deste impacto estimado, em centavos. */
  prioridade2MinCentavos: number;
  /** Abaixo desta confiança a prioridade desce um nível. */
  confiancaMinima: number;
  /**
   * Dias em que um alerta enviado ou descartado suprime o mesmo alerta (mesmo tipo e chave).
   * Zero desliga a supressão do tipo; `null` suprime enquanto existir um alerta tratado com a mesma
   * chave, sem limite de idade (para tipos cuja chave nunca precisa voltar).
   */
  janelaSupressaoDias: Readonly<Record<TipoAlerta, number | null>>;
}

export const LIMITES_PADRAO: LimitesDeAlerta = {
  reajusteLimiteBps: PARAMETROS_VARIACAO_CUSTO.limiteBps,
  reajusteJanelaDias: PARAMETROS_VARIACAO_CUSTO.janelaAlertaDias,
  reajusteMesmoMovimentoDias: 7,
  giroAltaMinimaBps: 0,
  estoqueParadoLimiteDias: PARAMETROS_ESTOQUE_PARADO.limiteDias,
  ticketQuedaLimiteBps: PARAMETROS_TICKET_MEDIO.limiteQuedaBps,
  gastoLimiteDesvio: PARAMETROS_GASTO_FORA_DO_PADRAO.limiteDesvio,
  prioridade1MinCentavos: 50_000,
  prioridade2MinCentavos: 10_000,
  confiancaMinima: 0.8,
  janelaSupressaoDias: {
    // A chave inclui a compra: o mesmo reajuste já tratado nunca precisa voltar, por mais velho que seja.
    reajuste_de_custo: null,
    margem_abaixo_da_meta: 7,
    espaco_para_subir_preco: 7,
    giro_em_alta: 7,
    estoque_parado: 7,
    // A chave destes dois é o dia, então um dia não repete o outro.
    ticket_medio_em_queda: 0,
    gasto_fora_do_padrao: 0,
  },
};

export type SobreposicaoDeLimites = Partial<Omit<LimitesDeAlerta, "janelaSupressaoDias">> & {
  janelaSupressaoDias?: Partial<Record<TipoAlerta, number | null>>;
};

/** Onde os limites próprios de cada comerciante moram. A fonte padrão não sobrepõe nada. */
export interface FonteDeLimites {
  limitesDoComerciante(comercianteId: string): Promise<SobreposicaoDeLimites>;
}

export const FONTE_DE_LIMITES = Symbol("FONTE_DE_LIMITES");

export const fonteDeLimitesPadrao: FonteDeLimites = {
  limitesDoComerciante: () => Promise.resolve({}),
};

/** Tira as chaves com valor indefinido: um `undefined` na sobreposição não pode apagar o padrão. */
function definidos<T extends object>(valores: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(valores ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function mesclarLimites(sobreposicao: SobreposicaoDeLimites): LimitesDeAlerta {
  const { janelaSupressaoDias, ...resto } = sobreposicao;
  return {
    ...LIMITES_PADRAO,
    ...definidos(resto),
    janelaSupressaoDias: { ...LIMITES_PADRAO.janelaSupressaoDias, ...definidos(janelaSupressaoDias) },
  };
}
