/**
 * As sete regras do motor (issue #43), uma por tipo de alerta. Cada uma relê o número que a métrica
 * já calculou contra o limite do comerciante; o impacto em centavos sai de contas inteiras sobre
 * esses números. Dado ausente não vira candidato nem zero.
 */
import { diasEntre } from "../lib/datas/datas";
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

/** Perda até a meta de margem nas unidades vendidas, arredondada uma vez só, no fim. */
function impactoDaMargem(
  precoCentavos: number,
  margemBps: number,
  metaBps: number,
  unidades: number,
): number {
  return Math.round((precoCentavos * (metaBps - margemBps) * unidades) / 10_000);
}

export const regraReajusteDeCusto: RegraDeAlerta = {
  tipo: "reajuste_de_custo",
  async avaliar({ metricas, dataReferencia, limites }) {
    const [variacoes, giro] = await Promise.all([metricas.variacoesDeCusto(), metricas.giro()]);
    const unidadesPorProduto = ehDadoAusente(giro)
      ? null
      : new Map(giro.valor.por_produto.map((g) => [g.produto_id, g.unidades_7_dias]));
    const candidatos: CandidatoDeAlerta[] = [];
    for (const v of variacoes.valor) {
      const dias = diasEntre(v.compra_atual_data, dataReferencia);
      if (v.variacao_bps <= limites.reajusteLimiteBps || dias < 0 || dias > limites.reajusteJanelaDias)
        continue;
      const unidades = unidadesPorProduto?.get(v.produto_id);
      candidatos.push({
        tipo: "reajuste_de_custo",
        chave: `${v.produto_id}:${v.fornecedor_id}:${v.compra_atual_data}`,
        produtoId: v.produto_id,
        fornecedorId: v.fornecedor_id,
        // Quanto a semana de venda passa a custar a mais com o custo novo.
        impactoCentavos:
          unidades === undefined
            ? null
            : Math.round((v.custo_atual_centavos - v.custo_anterior_centavos) * unidades),
        confianca: v.menor_confianca,
        metricasApoio: {
          produto_nome: v.nome,
          variacao_bps: v.variacao_bps,
          variacao_percentual: v.variacao_percentual,
          custo_anterior_centavos: v.custo_anterior_centavos,
          custo_atual_centavos: v.custo_atual_centavos,
          compra_anterior_data: v.compra_anterior_data,
          compra_atual_data: v.compra_atual_data,
          fonte: fonteDe(variacoes),
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
    for (const { produto_id, resultado } of await metricas.margens()) {
      if (ehDadoAusente(resultado)) {
        ausentes.push({ tipo: "margem_abaixo_da_meta", codigo: resultado.codigo, motivo: resultado.motivo });
        continue;
      }
      const m = resultado.valor;
      if (!m.abaixo_da_meta) continue;
      candidatos.push({
        tipo: "margem_abaixo_da_meta",
        chave: produto_id,
        produtoId: produto_id,
        fornecedorId: null,
        // Quanto a janela de preço deixou de render até a meta.
        impactoCentavos: impactoDaMargem(
          m.preco_medio_venda_centavos,
          m.margem_bps,
          m.meta_bps,
          m.unidades_vendidas,
        ),
        confianca: resultado.menor_confianca,
        metricasApoio: {
          produto_nome: m.nome,
          margem_bps: m.margem_bps,
          margem_percentual: m.margem_percentual,
          meta_bps: m.meta_bps,
          meta_percentual: m.meta_percentual,
          preco_medio_venda_centavos: m.preco_medio_venda_centavos,
          custo_compra_mais_recente_centavos: m.custo_compra_mais_recente_centavos,
          fonte: fonteDe(resultado),
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
      const conhecidas = [confiancaDoGiro, doProduto].filter((c): c is number => c !== null);
      return conhecidas.length === 0 ? null : Math.min(...conhecidas);
    };
    return {
      ausentes: [],
      candidatos: espaco.valor.map((p) => ({
        tipo: "espaco_para_subir_preco",
        chave: p.produto_id,
        produtoId: p.produto_id,
        fornecedorId: null,
        // O que a semana de venda renderia a mais com o preço na meta de margem.
        impactoCentavos: impactoDaMargem(
          p.preco_medio_venda_centavos,
          p.margem_bps,
          p.meta_bps,
          p.unidades_7_dias,
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
          impactoCentavos: (t.media_28_dias_centavos - t.ticket_medio_centavos) * t.cupons,
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
          // O que o dia gastou acima da mediana.
          impactoCentavos: g.valor_centavos - g.mediana_centavos,
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
