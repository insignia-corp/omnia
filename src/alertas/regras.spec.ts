import type { Giro, GiroDoProduto } from "../metricas/giro";
import type { MargemDoProduto } from "../metricas/margem-por-produto";
import type { MetricasService } from "../metricas/metricas.service";
import { dadoAusente, type ResultadoMetrica } from "../metricas/resultado-metrica";
import type { VariacaoDeCusto } from "../metricas/variacao-de-custo";
import { LIMITES_PADRAO, mesclarLimites, type SobreposicaoDeLimites } from "./limites";
import { MetricasDaExecucao, type ContextoDasRegras, type RegraDeAlerta } from "./regra";
import {
  regraEspacoParaSubirPreco,
  regraEstoqueParado,
  regraGastoForaDoPadrao,
  regraGiroEmAlta,
  regraMargemAbaixoDaMeta,
  regraReajusteDeCusto,
  regraTicketMedioEmQueda,
} from "./regras";

const REF = "2026-10-19";
const periodo = { inicio: "2026-09-20", fim: REF };
const resultado = <T>(valor: T, menor_confianca: number | null = 1): ResultadoMetrica<T> => ({
  valor,
  periodo,
  n_registros: 10,
  menor_confianca,
  origens: ["planilha"],
});

type Servico = Partial<Record<keyof MetricasService, unknown>>;

function contexto(servico: Servico, sobreposicao: SobreposicaoDeLimites = {}): ContextoDasRegras {
  const metricas = new MetricasDaExecucao(servico as unknown as MetricasService, {
    comercianteId: "c1",
    dataReferencia: REF,
  });
  return { comercianteId: "c1", dataReferencia: REF, limites: mesclarLimites(sobreposicao), metricas };
}

const rodar = (regra: RegraDeAlerta, servico: Servico, sobreposicao?: SobreposicaoDeLimites) =>
  regra.avaliar(contexto(servico, sobreposicao));

const variacao = (extra: Partial<VariacaoDeCusto> = {}): VariacaoDeCusto => ({
  produto_id: "p1",
  nome: "Arroz",
  fornecedor_id: "f1",
  custo_anterior_centavos: 2490,
  custo_atual_centavos: 2790,
  compra_anterior_data: "2026-09-14",
  compra_atual_data: "2026-10-16",
  compra_atual_id: "compra-16",
  variacao_bps: 1205,
  variacao_percentual: 12.05,
  acima_do_limite: true,
  recente: true,
  menor_confianca: 1,
  ...extra,
});

const giroDoProduto = (id: string, extra: Partial<GiroDoProduto> = {}): GiroDoProduto => ({
  produto_id: id,
  nome: id,
  unidades_7_dias: 36,
  unidades_28_dias_anteriores: 100,
  media_semanal_28_dias: 25,
  alta_bps: 4400,
  alta_percentual: 44,
  elegivel_para_alta: true,
  ...extra,
});

const giro = (produtos: GiroDoProduto[], altas = produtos, confianca = 1): ResultadoMetrica<Giro> =>
  resultado(
    {
      periodos: { ultimos_7_dias: periodo, anteriores_28_dias: periodo },
      por_produto: produtos,
      maior_alta: altas,
      maior_volume: [],
      giro_alto: [],
    },
    confianca,
  );

const margem = (extra: Partial<MargemDoProduto> = {}): MargemDoProduto => ({
  produto_id: "p1",
  nome: "Arroz",
  preco_medio_venda_centavos: 3499,
  unidades_vendidas: 150,
  custo_compra_mais_recente_centavos: 2790,
  compra_data: "2026-10-16",
  fornecedor_id: "f1",
  margem_bps: 2026,
  margem_percentual: 20.26,
  meta_bps: 2500,
  meta_percentual: 25,
  abaixo_da_meta: true,
  ...extra,
});

describe("regra de reajuste de custo", () => {
  const servicoCom = (
    variacoes: VariacaoDeCusto[],
    giroResultado: unknown = giro([giroDoProduto("p1")]),
  ) => ({
    variacoesDeCusto: () => Promise.resolve(resultado(variacoes)),
    giro: () => Promise.resolve(giroResultado),
  });

  it("gera candidato com os números da métrica e o impacto da semana de venda", async () => {
    const { candidatos } = await rodar(regraReajusteDeCusto, servicoCom([variacao()]));
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]).toMatchObject({
      tipo: "reajuste_de_custo",
      chave: "p1:f1:compra-16",
      produtoId: "p1",
      fornecedorId: "f1",
      // 300 centavos a mais por unidade, 36 unidades na semana
      impactoCentavos: 10_800,
      metricasApoio: { variacao_bps: 1205, custo_anterior_centavos: 2490, custo_atual_centavos: 2790 },
    });
  });

  it("duas compras do mesmo produto e fornecedor no mesmo dia têm chaves diferentes", async () => {
    const a = await rodar(regraReajusteDeCusto, servicoCom([variacao({ compra_atual_id: "compra-a" })]));
    const b = await rodar(regraReajusteDeCusto, servicoCom([variacao({ compra_atual_id: "compra-b" })]));
    expect(a.candidatos[0]?.chave).toBe("p1:f1:compra-a");
    expect(b.candidatos[0]?.chave).toBe("p1:f1:compra-b");
    expect(a.candidatos[0]?.metricasApoio).toMatchObject({ compra_atual_id: "compra-a" });
  });

  it("não gera abaixo do limite, em queda ou com a compra fora da janela", async () => {
    const { candidatos } = await rodar(
      regraReajusteDeCusto,
      servicoCom([
        variacao({ produto_id: "a", variacao_bps: 387 }),
        variacao({ produto_id: "b", variacao_bps: -310 }),
        variacao({ produto_id: "c", compra_atual_data: "2026-10-11" }),
        variacao({ produto_id: "d", variacao_bps: 500 }),
      ]),
    );
    expect(candidatos).toEqual([]);
  });

  it("a compra de exatamente 7 dias ainda conta", async () => {
    const { candidatos } = await rodar(
      regraReajusteDeCusto,
      servicoCom([variacao({ compra_atual_data: "2026-10-12" })]),
    );
    expect(candidatos).toHaveLength(1);
  });

  it("usa o limite do comerciante", async () => {
    const servico = servicoCom([variacao({ variacao_bps: 769 })]);
    expect((await rodar(regraReajusteDeCusto, servico)).candidatos).toHaveLength(1);
    expect((await rodar(regraReajusteDeCusto, servico, { reajusteLimiteBps: 1000 })).candidatos).toEqual([]);
  });

  it("sem giro o candidato sai, mas sem impacto em reais (nunca zero)", async () => {
    const { candidatos } = await rodar(
      regraReajusteDeCusto,
      servicoCom([variacao()], dadoAusente("sem_vendas", "sem vendas")),
    );
    expect(candidatos[0]?.impactoCentavos).toBeNull();
  });
});

const giroDe36 = () => Promise.resolve(giro([giroDoProduto("p1")]));

describe("regra de margem abaixo da meta", () => {
  it("gera candidato só para margem abaixo da meta, com o impacto da semana (7 dias, como as outras regras)", async () => {
    const { candidatos } = await rodar(regraMargemAbaixoDaMeta, {
      giro: giroDe36,
      margensDosProdutos: () =>
        Promise.resolve([
          { produto_id: "p1", resultado: resultado(margem()) },
          { produto_id: "p2", resultado: resultado(margem({ produto_id: "p2", abaixo_da_meta: false })) },
        ]),
    });
    expect(candidatos.map((c) => c.chave)).toEqual(["p1"]);
    expect(candidatos[0]).toMatchObject({
      impactoCentavos: 7956, // preço-alvo 3720 (custo 2790 / 0,75), 221 centavos a mais x 36 unidades da semana
      metricasApoio: { margem_bps: 2026, meta_bps: 2500 },
    });
  });

  it("sem giro o candidato sai sem impacto em reais (nunca zero) e com a confiança da margem", async () => {
    const { candidatos } = await rodar(regraMargemAbaixoDaMeta, {
      giro: () => Promise.resolve(dadoAusente("historico_insuficiente", "Faltam vendas.")),
      margensDosProdutos: () => Promise.resolve([{ produto_id: "p1", resultado: resultado(margem(), 0.9) }]),
    });
    expect(candidatos[0]).toMatchObject({ impactoCentavos: null, confianca: 0.9 });
  });

  it("com o impacto vindo do giro, a confiança é a menor entre a da margem e a do giro", async () => {
    const { candidatos } = await rodar(regraMargemAbaixoDaMeta, {
      giro: () => Promise.resolve(giro([giroDoProduto("p1")], undefined, 0.5)),
      margensDosProdutos: () => Promise.resolve([{ produto_id: "p1", resultado: resultado(margem(), 0.9) }]),
    });
    expect(candidatos[0]?.confianca).toBe(0.5);
  });

  it("dado ausente não vira candidato nem zero, e o motivo sai uma vez só", async () => {
    const ausente = dadoAusente("sem_custo", "Sem nota de compra.");
    const r = await rodar(regraMargemAbaixoDaMeta, {
      giro: giroDe36,
      margensDosProdutos: () =>
        Promise.resolve([
          { produto_id: "p1", resultado: ausente },
          { produto_id: "p2", resultado: ausente },
        ]),
    });
    expect(r.candidatos).toEqual([]);
    expect(r.ausentes).toEqual([
      { tipo: "margem_abaixo_da_meta", codigo: "sem_custo", motivo: "Sem nota de compra." },
    ]);
  });
});

describe("impacto até a meta de margem", () => {
  it("o preço-alvo arredonda para cima, para a meta de margem ficar garantida", async () => {
    // Custo 101 e meta 30%: 101 / 0,7 = 144,29. Com 144 a margem é 29,86%; só 145 atinge a meta.
    const { candidatos } = await rodar(regraMargemAbaixoDaMeta, {
      giro: () => Promise.resolve(giro([giroDoProduto("p1", { unidades_7_dias: 10 })])),
      margensDosProdutos: () =>
        Promise.resolve([
          {
            produto_id: "p1",
            resultado: resultado(
              margem({
                preco_medio_venda_centavos: 140,
                custo_compra_mais_recente_centavos: 101,
                meta_bps: 3000,
                margem_bps: 2786,
              }),
            ),
          },
        ]),
    });
    expect(candidatos[0]?.impactoCentavos).toBe(50); // (145 - 140) x 10 unidades
  });

  it("meta de 100% não tem preço que a atinja: sem impacto em reais, nunca zero", async () => {
    const { candidatos } = await rodar(regraMargemAbaixoDaMeta, {
      giro: giroDe36,
      margensDosProdutos: () =>
        Promise.resolve([
          { produto_id: "p1", resultado: resultado(margem({ meta_bps: 10_000, margem_bps: 2026 })) },
        ]),
    });
    expect(candidatos[0]?.impactoCentavos).toBeNull();
  });
});

describe("regra de giro em alta", () => {
  it("gera candidato para os de maior alta, sem impacto em reais", async () => {
    const { candidatos } = await rodar(regraGiroEmAlta, {
      giro: () => Promise.resolve(giro([giroDoProduto("p1")])),
    });
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]).toMatchObject({
      chave: "p1",
      impactoCentavos: null,
      metricasApoio: { alta_bps: 4400, unidades_7_dias: 36 },
    });
  });

  it("alta nula ou que não passa do mínimo não gera", async () => {
    const { candidatos } = await rodar(regraGiroEmAlta, {
      giro: () =>
        Promise.resolve(
          giro([
            giroDoProduto("a", { alta_bps: null }),
            giroDoProduto("b", { alta_bps: 0 }),
            giroDoProduto("c", { alta_bps: -300 }),
          ]),
        ),
    });
    expect(candidatos).toEqual([]);
  });

  it("giro ausente não gera candidato e informa o motivo", async () => {
    const r = await rodar(regraGiroEmAlta, {
      giro: () => Promise.resolve(dadoAusente("vendas_incompletas", "Faltam vendas.")),
    });
    expect(r.candidatos).toEqual([]);
    expect(r.ausentes).toEqual([
      { tipo: "giro_em_alta", codigo: "vendas_incompletas", motivo: "Faltam vendas." },
    ]);
  });
});

describe("regra de espaço para subir preço", () => {
  it("gera candidato com giro alto e margem abaixo da meta", async () => {
    const { candidatos } = await rodar(regraEspacoParaSubirPreco, {
      giro: () =>
        Promise.resolve({
          ...giro([giroDoProduto("p1")]),
          valor: { ...giro([giroDoProduto("p1")]).valor, giro_alto: ["p1"] },
        }),
      margensDosProdutos: () => Promise.resolve([{ produto_id: "p1", resultado: resultado(margem()) }]),
    });
    expect(candidatos).toHaveLength(1);
    expect(candidatos[0]).toMatchObject({
      tipo: "espaco_para_subir_preco",
      chave: "p1",
      impactoCentavos: 7956, // preço-alvo 3720 (custo 2790 / 0,75), 221 centavos a mais x 36 unidades
      metricasApoio: { margem_bps: 2026, meta_bps: 2500, unidades_7_dias: 36 },
    });
  });

  it("giro ausente não gera candidato", async () => {
    const r = await rodar(regraEspacoParaSubirPreco, {
      giro: () => Promise.resolve(dadoAusente("vendas_incompletas", "Faltam vendas.")),
      margensDosProdutos: () => Promise.resolve([]),
    });
    expect(r.candidatos).toEqual([]);
    expect(r.ausentes).toHaveLength(1);
  });
});

describe("regra de estoque parado", () => {
  const parado = (produto_id: string, dias_sem_venda: number) => ({
    produto_id,
    nome: produto_id,
    ultima_venda: "2026-09-08",
    dias_sem_venda,
    parado: dias_sem_venda > 30,
  });

  it("gera candidato só com mais dias que o limite", async () => {
    const servico = {
      estoqueParado: () => Promise.resolve(resultado([parado("a", 41), parado("b", 30), parado("c", 25)])),
    };
    expect((await rodar(regraEstoqueParado, servico)).candidatos.map((c) => c.chave)).toEqual(["a"]);
    expect(
      (await rodar(regraEstoqueParado, servico, { estoqueParadoLimiteDias: 20 })).candidatos.map(
        (c) => c.chave,
      ),
    ).toEqual(["a", "b", "c"]);
  });
});

describe("regra de ticket médio em queda", () => {
  const ticket = (queda_bps: number, extra: { cupons?: number; media?: number } = {}) =>
    resultado({
      data: REF,
      cupons: extra.cupons ?? 78,
      ticket_medio_centavos: 1566,
      media_28_dias_centavos: extra.media ?? 2753,
      queda_bps,
      queda_percentual: queda_bps / 100,
      queda_relevante: queda_bps >= 3000,
    });

  it("gera candidato com queda no limite ou acima, com a perda do dia como impacto", async () => {
    const { candidatos } = await rodar(regraTicketMedioEmQueda, {
      ticketMedio: () => Promise.resolve(ticket(4312)),
    });
    expect(candidatos[0]).toMatchObject({
      chave: REF,
      produtoId: null,
      impactoCentavos: 92_586,
      metricasApoio: { ticket_medio_centavos: 1566, media_28_dias_centavos: 2753, queda_bps: 4312 },
    });
    expect(
      (await rodar(regraTicketMedioEmQueda, { ticketMedio: () => Promise.resolve(ticket(3000)) })).candidatos,
    ).toHaveLength(1);
  });

  it("não gera abaixo do limite e respeita o limite do comerciante", async () => {
    const servico = { ticketMedio: () => Promise.resolve(ticket(2999)) };
    expect((await rodar(regraTicketMedioEmQueda, servico)).candidatos).toEqual([]);
    expect(
      (await rodar(regraTicketMedioEmQueda, servico, { ticketQuedaLimiteBps: 2000 })).candidatos,
    ).toHaveLength(1);
  });

  it("dia sem dado não é queda nem zero", async () => {
    const r = await rodar(regraTicketMedioEmQueda, {
      ticketMedio: () => Promise.resolve(dadoAusente("sem_venda_no_dia", "Sem vendas no dia.")),
    });
    expect(r.candidatos).toEqual([]);
    expect(r.ausentes).toEqual([
      { tipo: "ticket_medio_em_queda", codigo: "sem_venda_no_dia", motivo: "Sem vendas no dia." },
    ]);
  });
});

describe("regra de gasto fora do padrão", () => {
  const gasto = (
    desvio: number | null,
    extra: { valor?: number; mediana?: number; diferenca?: number } = {},
  ) =>
    resultado({
      data: REF,
      valor_centavos: extra.valor ?? 101_534,
      mediana_centavos: extra.mediana ?? 6093,
      diferenca_para_mediana_centavos: extra.diferenca ?? 101_534 - 6093,
      desvio_absoluto_mediano_centavos: 1747,
      desvio,
      dias_de_historico: 60,
      acima_do_limite: desvio !== null && desvio > 3,
    });

  it("o impacto arredonda a diferença uma vez só: 15000 menos a mediana 5000,5 é 10000, não 9999", async () => {
    const { candidatos } = await rodar(regraGastoForaDoPadrao, {
      // mediana_centavos 5001 já veio arredondada; a diferença exata é 9999,5.
      gastoForaDoPadrao: () =>
        Promise.resolve(gasto(54, { valor: 15_000, mediana: 5001, diferenca: 10_000 })),
    });
    expect(candidatos[0]?.impactoCentavos).toBe(10_000);
  });

  it("gera candidato com desvio acima do limite", async () => {
    const { candidatos } = await rodar(regraGastoForaDoPadrao, {
      gastoForaDoPadrao: () => Promise.resolve(gasto(54.62)),
    });
    expect(candidatos[0]).toMatchObject({
      chave: REF,
      impactoCentavos: 95_441,
      metricasApoio: { valor_centavos: 101_534, mediana_centavos: 6093, desvio: 54.62 },
    });
  });

  it("desvio no limite, nulo ou sem extrato não gera", async () => {
    expect(
      (await rodar(regraGastoForaDoPadrao, { gastoForaDoPadrao: () => Promise.resolve(gasto(3)) }))
        .candidatos,
    ).toEqual([]);
    expect(
      (await rodar(regraGastoForaDoPadrao, { gastoForaDoPadrao: () => Promise.resolve(gasto(null)) }))
        .candidatos,
    ).toEqual([]);
    const ausente = await rodar(regraGastoForaDoPadrao, {
      gastoForaDoPadrao: () => Promise.resolve(dadoAusente("sem_extrato_no_dia", "Sem extrato.")),
    });
    expect(ausente.candidatos).toEqual([]);
    expect(ausente.ausentes).toHaveLength(1);
  });
});

describe("limites padrão", () => {
  it("sobreposição parcial mantém o resto", () => {
    const limites = mesclarLimites({ reajusteLimiteBps: 900, janelaSupressaoDias: { estoque_parado: 14 } });
    expect(limites.reajusteLimiteBps).toBe(900);
    expect(limites.ticketQuedaLimiteBps).toBe(LIMITES_PADRAO.ticketQuedaLimiteBps);
    expect(limites.janelaSupressaoDias.estoque_parado).toBe(14);
    expect(limites.janelaSupressaoDias.reajuste_de_custo).toBeNull();
    expect(limites.janelaSupressaoDias.giro_em_alta).toBe(7);
  });
});
