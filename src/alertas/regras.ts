/**
 * As sete regras do motor (issue #43), uma por tipo de alerta. Cada uma relê o número que a métrica
 * já calculou contra o limite do comerciante; o impacto em centavos sai de contas inteiras sobre
 * esses números. Dado ausente não vira candidato nem zero.
 */
import { diasEntre } from "../lib/datas/datas";
import { centavos, ErroDinheiro, multiplicar } from "../lib/dinheiro/dinheiro";
import { ehDadoAusente, type DadoAusente } from "../metricas/resultado-metrica";
import {
  fonteDe,
  type CandidatoDeAlerta,
  type MotivoAusente,
  type RegraDeAlerta,
  type ResultadoDaRegra,
} from "./regra";
import type { TipoAlerta } from "./tipos";

const semCandidato = (tipo: TipoAlerta, ausente: DadoAusente): ResultadoDaRegra => ({
  candidatos: [],
  ausentes: [{ tipo, codigo: ausente.codigo, motivo: ausente.motivo }],
});

/** Um motivo por código: 50 produtos sem custo são um aviso só. */
function motivosUnicos(motivos: MotivoAusente[]): MotivoAusente[] {
  return [...new Map(motivos.map((m) => [m.codigo, m])).values()];
}

/**
 * Impacto em centavos. Um valor que não cabe em centavos inteiros seguros (soma enorme vinda de
 * agregados do banco) vira impacto nulo, nunca um número impreciso gravado no alerta.
 */
function impactoOuNulo(calcular: () => number | null): number | null {
  try {
    return calcular();
  } catch (e) {
    if (e instanceof ErroDinheiro) return null;
    throw e;
  }
}

/** A menor das confianças conhecidas; nula quando nenhuma é conhecida. */
function menorConhecida(...confiancas: Array<number | null>): number | null {
  const conhecidas = confiancas.filter((c): c is number => c !== null);
  return conhecidas.length === 0 ? null : Math.min(...conhecidas);
}

/**
 * O que as unidades vendidas renderiam a mais com o preço que dá a meta de margem. O preço-alvo sai
 * de custo / (1 - meta), arredondado para cima: a margem tem o preço no denominador, então diferença de margem
 * vezes preço não é o aumento de preço necessário. Nulo quando a meta é 100% (sem preço que a atinja).
 */
function impactoDeChegarNaMeta(
  precoCentavos: number,
  custoCentavos: number,
  metaBps: number,
  unidades: number,
): number | null {
  const denominador = 10_000 - metaBps;
  if (denominador <= 0) return null;
  // Para cima: arredondar para baixo deixaria a margem do preço-alvo um pouco abaixo da meta. Os
  // dois lados são inteiros seguros (`centavos` recusa o que não cabe), e uma divisão exata de
  // inteiros é exata em ponto flutuante.
  const precoAlvo = centavos(Math.ceil(centavos(custoCentavos * 10_000) / denominador));
  return multiplicar(centavos(Math.max(0, precoAlvo - precoCentavos)), unidades);
}

export const regraReajusteDeCusto: RegraDeAlerta = {
  tipo: "reajuste_de_custo",
  async avaliar({ metricas, dataReferencia, limites }) {
    const [variacoes, giro] = await Promise.all([metricas.variacoesDeCusto(), metricas.giro()]);
    const giroPorProduto = ehDadoAusente(giro)
      ? null
      : new Map(giro.valor.por_produto.map((g) => [g.produto_id, g]));
    const candidatos: CandidatoDeAlerta[] = [];
    for (const v of variacoes.valor) {
      const dias = diasEntre(v.compra_atual_data, dataReferencia);
      if (v.variacao_bps <= limites.reajusteLimiteBps || dias < 0 || dias > limites.reajusteJanelaDias)
        continue;
      const doGiro = giroPorProduto?.get(v.produto_id);
      const usaGiro = !ehDadoAusente(giro) && doGiro !== undefined;
      candidatos.push({
        tipo: "reajuste_de_custo",
        chave: `${v.produto_id}:${v.fornecedor_id}:${v.compra_atual_id}`,
        produtoId: v.produto_id,
        fornecedorId: v.fornecedor_id,
        // Quanto a semana de venda passa a custar a mais com o custo novo.
        impactoCentavos: doGiro
          ? impactoOuNulo(() =>
              multiplicar(
                centavos(v.custo_atual_centavos - v.custo_anterior_centavos),
                doGiro.unidades_7_dias,
              ),
            )
          : null,
        // O impacto depende das vendas: com ele, vale a menor entre a confiança do custo e a do giro.
        confianca: usaGiro ? menorConhecida(v.menor_confianca, giro.menor_confianca) : v.menor_confianca,
        metricasApoio: {
          produto_nome: v.nome,
          variacao_bps: v.variacao_bps,
          variacao_percentual: v.variacao_percentual,
          custo_anterior_centavos: v.custo_anterior_centavos,
          custo_atual_centavos: v.custo_atual_centavos,
          compra_anterior_data: v.compra_anterior_data,
          compra_atual_data: v.compra_atual_data,
          compra_atual_id: v.compra_atual_id,
          fonte: fonteDe(variacoes),
          ...(usaGiro ? { unidades_7_dias: doGiro.unidades_7_dias, giro_fonte: fonteDe(giro) } : {}),
        },
      });
    }
    return { candidatos, ausentes: [] };
  },
};

export const regraMargemAbaixoDaMeta: RegraDeAlerta = {
  tipo: "margem_abaixo_da_meta",
  async avaliar({ metricas }) {
    const candidatos: CandidatoDeAlerta[] = [];
    const ausentes: MotivoAusente[] = [];
    const [margens, giro] = await Promise.all([metricas.margens(), metricas.giro()]);
    const giroPorProduto = ehDadoAusente(giro)
      ? null
      : new Map(giro.valor.por_produto.map((g) => [g.produto_id, g]));
    for (const { produto_id, resultado } of margens) {
      if (ehDadoAusente(resultado)) {
        ausentes.push({ tipo: "margem_abaixo_da_meta", codigo: resultado.codigo, motivo: resultado.motivo });
        continue;
      }
      const m = resultado.valor;
      if (!m.abaixo_da_meta) continue;
      const doGiro = giroPorProduto?.get(produto_id);
      const usaGiro = !ehDadoAusente(giro) && doGiro !== undefined;
      candidatos.push({
        tipo: "margem_abaixo_da_meta",
        chave: produto_id,
        produtoId: produto_id,
        fornecedorId: null,
        // Quanto a semana de venda (7 dias, a mesma base das outras regras) renderia a mais com o
        // preço na meta de margem. Sem giro não há volume da semana: sem impacto, nunca zero.
        impactoCentavos: doGiro
          ? impactoOuNulo(() =>
              impactoDeChegarNaMeta(
                m.preco_medio_venda_centavos,
                m.custo_compra_mais_recente_centavos,
                m.meta_bps,
                doGiro.unidades_7_dias,
              ),
            )
          : null,
        confianca: usaGiro
          ? menorConhecida(resultado.menor_confianca, giro.menor_confianca)
          : resultado.menor_confianca,
        metricasApoio: {
          produto_nome: m.nome,
          margem_bps: m.margem_bps,
          margem_percentual: m.margem_percentual,
          meta_bps: m.meta_bps,
          meta_percentual: m.meta_percentual,
          preco_medio_venda_centavos: m.preco_medio_venda_centavos,
          custo_compra_mais_recente_centavos: m.custo_compra_mais_recente_centavos,
          fonte: fonteDe(resultado),
          ...(usaGiro ? { unidades_7_dias: doGiro.unidades_7_dias, giro_fonte: fonteDe(giro) } : {}),
        },
      });
    }
    return { candidatos, ausentes: motivosUnicos(ausentes) };
  },
};

export const regraGiroEmAlta: RegraDeAlerta = {
  tipo: "giro_em_alta",
  async avaliar({ metricas, limites }) {
    const giro = await metricas.giro();
    if (ehDadoAusente(giro)) return semCandidato("giro_em_alta", giro);
    const candidatos: CandidatoDeAlerta[] = [];
    for (const g of giro.valor.maior_alta) {
      if (g.alta_bps === null || g.alta_bps <= limites.giroAltaMinimaBps) continue;
      candidatos.push({
        tipo: "giro_em_alta",
        chave: g.produto_id,
        produtoId: g.produto_id,
        fornecedorId: null,
        // Oportunidade, não perda: sem valor em reais, entra no nível mais baixo.
        impactoCentavos: null,
        confianca: giro.menor_confianca,
        metricasApoio: {
          produto_nome: g.nome,
          alta_bps: g.alta_bps,
          alta_percentual: g.alta_percentual,
          unidades_7_dias: g.unidades_7_dias,
          unidades_28_dias_anteriores: g.unidades_28_dias_anteriores,
          media_semanal_28_dias: g.media_semanal_28_dias,
          fonte: fonteDe(giro),
        },
      });
    }
    return { candidatos, ausentes: [] };
  },
};

export const regraEspacoParaSubirPreco: RegraDeAlerta = {
  tipo: "espaco_para_subir_preco",
  async avaliar({ metricas }) {
    const [espaco, giro, margens] = await Promise.all([
      metricas.espacoParaSubirPreco(),
      metricas.giro(),
      metricas.margens(),
    ]);
    if (ehDadoAusente(espaco)) return semCandidato("espaco_para_subir_preco", espaco);
    // A confiança do candidato é a do giro e a da margem do próprio produto, não a da lista inteira.
    const confiancaDoGiro = ehDadoAusente(giro) ? null : giro.menor_confianca;
    const confiancaDe = (produtoId: string): number | null => {
      const margem = margens.find((m) => m.produto_id === produtoId)?.resultado;
      const doProduto = !margem || ehDadoAusente(margem) ? null : margem.menor_confianca;
      return menorConhecida(confiancaDoGiro, doProduto);
    };
    return {
      ausentes: [],
      candidatos: espaco.valor.map((p) => ({
        tipo: "espaco_para_subir_preco",
        chave: p.produto_id,
        produtoId: p.produto_id,
        fornecedorId: null,
        // O que a semana de venda renderia a mais com o preço na meta de margem.
        impactoCentavos: impactoOuNulo(() =>
          impactoDeChegarNaMeta(
            p.preco_medio_venda_centavos,
            p.custo_compra_mais_recente_centavos,
            p.meta_bps,
            p.unidades_7_dias,
          ),
        ),
        confianca: confiancaDe(p.produto_id),
        metricasApoio: {
          produto_nome: p.nome,
          margem_bps: p.margem_bps,
          margem_percentual: p.margem_percentual,
          meta_bps: p.meta_bps,
          meta_percentual: p.meta_percentual,
          preco_medio_venda_centavos: p.preco_medio_venda_centavos,
          custo_compra_mais_recente_centavos: p.custo_compra_mais_recente_centavos,
          unidades_7_dias: p.unidades_7_dias,
          alta_bps: p.alta_bps,
          alta_percentual: p.alta_percentual,
          fonte: fonteDe(espaco),
        },
      })),
    };
  },
};

export const regraEstoqueParado: RegraDeAlerta = {
  tipo: "estoque_parado",
  async avaliar({ metricas, limites }) {
    // A métrica já corta a lista em 30 dias: um limite menor que o dela não traz produto novo.
    const parados = await metricas.estoqueParado();
    return {
      ausentes: [],
      candidatos: parados.valor
        .filter((p) => p.dias_sem_venda > limites.estoqueParadoLimiteDias)
        .map((p) => ({
          tipo: "estoque_parado",
          chave: p.produto_id,
          produtoId: p.produto_id,
          fornecedorId: null,
          // Sem estoque em unidades não há valor parado em reais.
          impactoCentavos: null,
          confianca: parados.menor_confianca,
          metricasApoio: {
            produto_nome: p.nome,
            dias_sem_venda: p.dias_sem_venda,
            ultima_venda: p.ultima_venda,
            fonte: fonteDe(parados),
          },
        })),
    };
  },
};

export const regraTicketMedioEmQueda: RegraDeAlerta = {
  tipo: "ticket_medio_em_queda",
  async avaliar({ metricas, limites }) {
    const ticket = await metricas.ticketMedio();
    if (ehDadoAusente(ticket)) return semCandidato("ticket_medio_em_queda", ticket);
    const t = ticket.valor;
    if (t.queda_bps < limites.ticketQuedaLimiteBps) return { candidatos: [], ausentes: [] };
    return {
      ausentes: [],
      candidatos: [
        {
          tipo: "ticket_medio_em_queda",
          chave: t.data,
          produtoId: null,
          fornecedorId: null,
          // O que os cupons do dia deixaram de render contra a média dos 28 dias.
          impactoCentavos: impactoOuNulo(() =>
            multiplicar(centavos(t.media_28_dias_centavos - t.ticket_medio_centavos), t.cupons),
          ),
          confianca: ticket.menor_confianca,
          metricasApoio: {
            data: t.data,
            cupons: t.cupons,
            ticket_medio_centavos: t.ticket_medio_centavos,
            media_28_dias_centavos: t.media_28_dias_centavos,
            queda_bps: t.queda_bps,
            queda_percentual: t.queda_percentual,
            fonte: fonteDe(ticket),
          },
        },
      ],
    };
  },
};

export const regraGastoForaDoPadrao: RegraDeAlerta = {
  tipo: "gasto_fora_do_padrao",
  async avaliar({ metricas, limites }) {
    const gasto = await metricas.gastoForaDoPadrao();
    if (ehDadoAusente(gasto)) return semCandidato("gasto_fora_do_padrao", gasto);
    const g = gasto.valor;
    // Desvio nulo (desvio absoluto mediano zero) não mede nada: sem candidato, nunca zero.
    if (g.desvio === null || g.desvio <= limites.gastoLimiteDesvio) return { candidatos: [], ausentes: [] };
    return {
      ausentes: [],
      candidatos: [
        {
          tipo: "gasto_fora_do_padrao",
          chave: g.data,
          produtoId: null,
          fornecedorId: null,
          // O que o dia gastou acima da mediana, já arredondado uma vez só pela métrica.
          impactoCentavos: impactoOuNulo(() => {
            // A métrica faz 2 x valor para somar meios de centavo: os dois precisam caber.
            centavos(2 * g.valor_centavos);
            return centavos(g.diferenca_para_mediana_centavos);
          }),
          confianca: gasto.menor_confianca,
          metricasApoio: {
            data: g.data,
            valor_centavos: g.valor_centavos,
            mediana_centavos: g.mediana_centavos,
            desvio_absoluto_mediano_centavos: g.desvio_absoluto_mediano_centavos,
            desvio: g.desvio,
            dias_de_historico: g.dias_de_historico,
            fonte: fonteDe(gasto),
          },
        },
      ],
    };
  },
};

export const REGRAS_DE_ALERTA: readonly RegraDeAlerta[] = [
  regraReajusteDeCusto,
  regraMargemAbaixoDaMeta,
  regraEspacoParaSubirPreco,
  regraGiroEmAlta,
  regraEstoqueParado,
  regraTicketMedioEmQueda,
  regraGastoForaDoPadrao,
];
