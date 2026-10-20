import { bpsParaPercentual, dividirArredondando, mediana, razaoEmBps } from "./aritmetica";
import { diferencaEmDias, intervalo, somarDias } from "./datas";
import { gerarExtrato, CATEGORIAS_FORA_DO_PADRAO, GASTO_ANOMALO } from "./extrato";
import { catalogo, DATA_REFERENCIA, perfil } from "./mercadinho";
import { itensDeCompra } from "./notas";
import { DIA_TICKET_BAIXO } from "./vendas";
import type { ItemVenda, Transacao } from "./tipos";

/**
 * Gabarito das métricas, calculado aqui de forma independente das funções que a Etapa 3 vai
 * escrever em src/metricas. Só aritmética inteira. As definições seguem o guia de
 * desenvolvimento ("Métricas determinísticas") e os parâmetros abaixo.
 */
export const PARAMETROS = {
  data_referencia: DATA_REFERENCIA,
  meta_margem_bps: perfil.meta_margem_bps,
  /** Variação de custo acima disso (estrito) gera alerta: 5%. */
  limite_variacao_custo_bps: 500,
  /** Janela de giro: últimos 7 dias contra a média semanal dos 28 dias anteriores. */
  giro_dias_recentes: 7,
  giro_dias_base: 28,
  /** Produtos com menos unidades que isso na base ficam fora do ranking de alta (ruído). */
  giro_volume_minimo_base: 40,
  /** Alta mínima de giro para contar como "giro alto": +50%. */
  giro_alto_bps: 5000,
  estoque_parado_dias: 30,
  /** Queda do ticket médio contra os 28 dias anteriores que conta como relevante: 15%. */
  ticket_queda_relevante_bps: 1500,
  gasto_janela_dias: 60,
  /** Desvio robusto acima disso gera alerta. */
  gasto_desvio_limite_milli: 3000,
  gasto_categorias_excluidas: CATEGORIAS_FORA_DO_PADRAO,
  gasto_datas_avaliadas: ["2026-10-12", "2026-10-14", "2026-10-16", DATA_REFERENCIA],
};

export interface AlertaEsperado {
  tipo: string;
  chave: string;
  motivo: string;
}

function somaPorData(itens: readonly ItemVenda[], de: string, ate: string): ItemVenda[] {
  return itens.filter((i) => i.data >= de && i.data <= ate);
}

export function gerarGabaritoMetricas(vendas: readonly ItemVenda[], extrato?: readonly Transacao[]) {
  const ref = DATA_REFERENCIA;
  const compras = itensDeCompra().sort(
    (a, b) => a.data.localeCompare(b.data) || a.nota_id.localeCompare(b.nota_id),
  );
  const meta = PARAMETROS.meta_margem_bps;

  // Margem: (preço médio de venda - custo da compra mais recente) / preço médio de venda.
  const margem = catalogo.map((p) => {
    const vendidos = vendas.filter((v) => v.sku === p.sku);
    const unidades = vendidos.reduce((a, v) => a + v.quantidade, 0);
    const receita = vendidos.reduce((a, v) => a + v.quantidade * v.preco_unitario_centavos, 0);
    const precoMedio = unidades > 0 ? dividirArredondando(receita, unidades) : null;
    const maisRecente = compras.filter((c) => c.sku === p.sku).at(-1);
    if (precoMedio === null || !maisRecente) {
      return {
        sku: p.sku,
        codigo_barras: p.codigo_barras,
        nome: p.nome,
        ausente: true as const,
        motivo: precoMedio === null ? "sem vendas no período" : "sem compra registrada, custo desconhecido",
      };
    }
    const bps = razaoEmBps(precoMedio - maisRecente.custo_unitario_centavos, precoMedio);
    return {
      sku: p.sku,
      codigo_barras: p.codigo_barras,
      nome: p.nome,
      ausente: false as const,
      preco_medio_venda_centavos: precoMedio,
      custo_mais_recente_centavos: maisRecente.custo_unitario_centavos,
      custo_fornecedor_id: maisRecente.fornecedor_id,
      custo_data: maisRecente.data,
      margem_bps: bps,
      margem_percentual: bpsParaPercentual(bps),
      abaixo_da_meta: bps < meta,
      n_registros: unidades,
    };
  });

  // Giro.
  const inicioRecente = somarDias(ref, -(PARAMETROS.giro_dias_recentes - 1));
  const fimBase = somarDias(inicioRecente, -1);
  const inicioBase = somarDias(fimBase, -(PARAMETROS.giro_dias_base - 1));
  const recentes = somaPorData(vendas, inicioRecente, ref);
  const base = somaPorData(vendas, inicioBase, fimBase);
  const semanas = PARAMETROS.giro_dias_base / 7;
  const giro = catalogo.map((p) => {
    const u7 = recentes.filter((v) => v.sku === p.sku).reduce((a, v) => a + v.quantidade, 0);
    const u28 = base.filter((v) => v.sku === p.sku).reduce((a, v) => a + v.quantidade, 0);
    // media semanal = u28 / 4; variação = (u7 - u28/4) / (u28/4) = (4 * u7 - u28) / u28
    const variacao = u28 > 0 ? razaoEmBps(semanas * u7 - u28, u28) : null;
    return {
      sku: p.sku,
      nome: p.nome,
      unidades_7_dias: u7,
      unidades_28_dias_anteriores: u28,
      variacao_bps: variacao,
      elegivel_ranking_alta: u28 >= PARAMETROS.giro_volume_minimo_base,
    };
  });
  const topAlta = giro
    .filter((g) => g.elegivel_ranking_alta && g.variacao_bps !== null)
    .sort((a, b) => b.variacao_bps! - a.variacao_bps! || a.sku.localeCompare(b.sku))
    .slice(0, 5)
    .map((g) => g.sku);
  const topVolume = [...giro]
    .sort((a, b) => b.unidades_7_dias - a.unidades_7_dias || a.sku.localeCompare(b.sku))
    .slice(0, 5)
    .map((g) => g.sku);

  // Variação de custo: duas compras mais recentes do mesmo produto e fornecedor.
  const variacaoCusto = catalogo.flatMap((p) => {
    const fornecedores = [
      ...new Set(compras.filter((c) => c.sku === p.sku).map((c) => c.fornecedor_id)),
    ].sort();
    return fornecedores.flatMap((f) => {
      const historico = compras.filter((c) => c.sku === p.sku && c.fornecedor_id === f);
      if (historico.length < 2) return [];
      const anterior = historico.at(-2)!;
      const atual = historico.at(-1)!;
      const bps = razaoEmBps(
        atual.custo_unitario_centavos - anterior.custo_unitario_centavos,
        anterior.custo_unitario_centavos,
      );
      return [
        {
          sku: p.sku,
          nome: p.nome,
          fornecedor_id: f,
          compra_anterior: {
            data: anterior.data,
            nota_id: anterior.nota_id,
            custo_centavos: anterior.custo_unitario_centavos,
          },
          compra_atual: {
            data: atual.data,
            nota_id: atual.nota_id,
            custo_centavos: atual.custo_unitario_centavos,
          },
          variacao_bps: bps,
          variacao_percentual: bpsParaPercentual(bps),
          acima_do_limite: bps > PARAMETROS.limite_variacao_custo_bps,
        },
      ];
    });
  });

  // Espaço para subir preço: giro alto e margem abaixo da meta, juntos.
  const espaco = margem
    .filter((m) => !m.ausente && m.abaixo_da_meta)
    .map((m) => m.sku)
    .filter((sku) => {
      const g = giro.find((x) => x.sku === sku)!;
      return g.elegivel_ranking_alta && g.variacao_bps !== null && g.variacao_bps >= PARAMETROS.giro_alto_bps;
    });

  // Estoque parado: produto comprado e sem venda há mais de N dias.
  const comprados = new Set(compras.map((c) => c.sku));
  const estoqueParado = [...comprados].sort().map((sku) => {
    const ultima =
      vendas
        .filter((v) => v.sku === sku)
        .map((v) => v.data)
        .sort()
        .at(-1) ?? null;
    const dias = ultima === null ? null : diferencaEmDias(ultima, ref);
    return {
      sku,
      nome: catalogo.find((p) => p.sku === sku)!.nome,
      ultima_venda: ultima,
      dias_sem_venda: dias,
      acima_do_limite: dias !== null && dias > PARAMETROS.estoque_parado_dias,
    };
  });

  // Ticket médio do dia contra os 28 dias anteriores (faturamento total / número de vendas).
  const resumoDia = (de: string, ate: string) => {
    const itens = somaPorData(vendas, de, ate);
    return {
      faturamento_centavos: itens.reduce((a, v) => a + v.quantidade * v.preco_unitario_centavos, 0),
      n_vendas: new Set(itens.map((v) => v.venda_id)).size,
    };
  };
  const dia = resumoDia(ref, ref);
  const base28 = resumoDia(somarDias(ref, -28), somarDias(ref, -1));
  const ticketDia = dividirArredondando(dia.faturamento_centavos, dia.n_vendas);
  const ticketBase = dividirArredondando(base28.faturamento_centavos, base28.n_vendas);
  const quedaBps = razaoEmBps(ticketBase - ticketDia, ticketBase);
  const ticket = {
    data: ref,
    dia: { ...dia, ticket_medio_centavos: ticketDia },
    base_28_dias: { ...base28, ticket_medio_centavos: ticketBase },
    queda_bps: quedaBps,
    queda_percentual: bpsParaPercentual(quedaBps),
    alerta: quedaBps >= PARAMETROS.ticket_queda_relevante_bps,
  };

  // Gasto fora do padrão: (valor do dia - mediana dos 60 dias anteriores) / desvio absoluto mediano.
  const transacoes = extrato ?? gerarExtrato(vendas);
  const gastoDoDia = (data: string) =>
    transacoes
      .filter(
        (t) =>
          t.tipo === "saida" &&
          t.data === data &&
          !PARAMETROS.gasto_categorias_excluidas.includes(t.categoria),
      )
      .reduce((a, t) => a + t.valor_centavos, 0);
  const gastoFora = PARAMETROS.gasto_datas_avaliadas.map((data) => {
    const janela = intervalo(somarDias(data, -PARAMETROS.gasto_janela_dias), somarDias(data, -1)).map(
      gastoDoDia,
    );
    const med = mediana(janela);
    const mad = mediana(janela.map((v) => Math.abs(v - med)));
    const valor = gastoDoDia(data);
    const desvioMilli = mad === 0 ? null : dividirArredondando((valor - med) * 1000, mad);
    return {
      data,
      valor_centavos: valor,
      mediana_centavos: med,
      desvio_absoluto_mediano_centavos: mad,
      desvio_milli: desvioMilli,
      alerta: desvioMilli !== null && desvioMilli > PARAMETROS.gasto_desvio_limite_milli,
    };
  });

  const alertasEsperados: AlertaEsperado[] = [
    ...variacaoCusto
      .filter((v) => v.acima_do_limite)
      .map((v) => ({
        tipo: "variacao_custo",
        chave: `${v.sku}:${v.fornecedor_id}`,
        motivo: `${v.nome} subiu ${v.variacao_percentual}% entre ${v.compra_anterior.data} e ${v.compra_atual.data}`,
      })),
    ...espaco.map((sku) => ({
      tipo: "espaco_para_subir_preco",
      chave: sku,
      motivo: "giro alto e margem abaixo da meta",
    })),
    ...estoqueParado
      .filter((e) => e.acima_do_limite)
      .map((e) => ({
        tipo: "estoque_parado",
        chave: e.sku,
        motivo: `${e.dias_sem_venda} dias sem venda`,
      })),
    ...(ticket.alerta
      ? [{ tipo: "ticket_medio", chave: ref, motivo: `ticket ${ticket.queda_percentual}% abaixo da base` }]
      : []),
    ...gastoFora
      .filter((g) => g.alerta)
      .map((g) => ({
        tipo: "gasto_fora_do_padrao",
        chave: g.data,
        motivo: `gasto do dia muito acima da mediana`,
      })),
  ];

  const alertasQueNaoDevemDisparar: AlertaEsperado[] = [
    ...variacaoCusto
      .filter((v) => !v.acima_do_limite && v.variacao_bps !== 0)
      .map((v) => ({
        tipo: "variacao_custo",
        chave: `${v.sku}:${v.fornecedor_id}`,
        motivo: `variação de ${v.variacao_percentual}% está dentro do limite`,
      })),
    {
      tipo: "variacao_custo",
      chave: "ovos-troca-de-fornecedor",
      motivo: "Ovos subiram de R$ 7,80 (F6) para R$ 9,00 (F3), mas são fornecedores diferentes",
    },
    ...gastoFora
      .filter((g) => !g.alerta)
      .map((g) => ({
        tipo: "gasto_fora_do_padrao",
        chave: g.data,
        motivo: "gasto do dia dentro do padrão",
      })),
  ];

  return {
    parametros: PARAMETROS,
    janelas: {
      giro_recente: { inicio: inicioRecente, fim: ref },
      giro_base: { inicio: inicioBase, fim: fimBase },
    },
    margem_por_produto: margem,
    giro: { por_produto: giro, top_alta: topAlta, top_volume: topVolume },
    variacao_de_custo: variacaoCusto,
    espaco_para_subir_preco: espaco,
    estoque_parado: estoqueParado,
    ticket_medio: ticket,
    gasto_fora_do_padrao: gastoFora,
    alertas_esperados: alertasEsperados,
    alertas_que_nao_devem_disparar: alertasQueNaoDevemDisparar,
    plantados: {
      reajuste: {
        sku: catalogo.find((p) => p.nome === "Refrigerante Cola 2L")!.sku,
        nota_anterior: "nota-01",
        nota_atual: "nota-12",
      },
      gasto_anomalo: GASTO_ANOMALO,
      dia_ticket_baixo: DIA_TICKET_BAIXO,
    },
  };
}

export type GabaritoMetricas = ReturnType<typeof gerarGabaritoMetricas>;
