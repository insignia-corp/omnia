import type { CustoDeCompra } from "../metricas/dados-de-metricas";
import { mesclarLimites } from "./limites";
import { recalcularReajuste } from "./recalculo-de-reajuste";

const limites = mesclarLimites({});

let ordem = 0;
/** Uma leitura vigente; `criado` ordena as do mesmo dia (o que `reemitirCustos` muda). */
const leitura = (
  compraId: string,
  data: string,
  custo: number,
  criado = ++ordem,
  confianca = 1,
): CustoDeCompra => ({
  produtoId: "p1",
  fornecedorId: "f1",
  compraId,
  itemDeCompraId: `item-${compraId}-${criado}`,
  data,
  custoUnitarioCentavos: custo,
  confianca,
  origem: "foto_nota",
  criadoEm: new Date(2026, 9, 1, 0, 0, criado),
});

const apoio = (compra: string, extra: Record<string, unknown> = {}) => ({
  produto_nome: "Arroz",
  custo_anterior_centavos: 2490,
  custo_atual_centavos: 2790,
  variacao_bps: 1205,
  compra_atual_id: compra,
  unidades_7_dias: 10,
  ...extra,
});

describe("recalcularReajuste (#186)", () => {
  it("alta que continua acima do limite: números, impacto e prioridade refeitos", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("W", "2026-10-10", 2000), leitura("X", "2026-10-16", 2800)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toMatchObject({
      situacao: "vale",
      metricasApoio: {
        custo_anterior_centavos: 2000,
        custo_atual_centavos: 2800,
        variacao_bps: 4000,
        compra_anterior_data: "2026-10-10",
        compra_atual_data: "2026-10-16",
        impacto_centavos: 8000,
        menor_confianca: 1,
        produto_nome: "Arroz",
      },
    });
  });

  it("2ª compra do par no dia: a compra do alerta não é a atual, mas a alta dela continua", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [
        leitura("W", "2026-10-10", 2490),
        leitura("X", "2026-10-16", 2790),
        leitura("Y", "2026-10-16", 2790),
      ],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toMatchObject({ situacao: "vale", metricasApoio: { custo_anterior_centavos: 2490 } });
  });

  it("nota mais antiga do mesmo dia: vira a anterior da compra do alerta", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("Z", "2026-10-16", 2490, 1), leitura("X", "2026-10-16", 2790, 2)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toMatchObject({ situacao: "vale", metricasApoio: { custo_anterior_centavos: 2490 } });
  });

  it("reemitirCustos da nota anterior (leitura nova depois da X) tira ela de antes da X", () => {
    // Z foi lida de novo depois de X: já não vem antes dela; sem outra compra antes, a alta some.
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("X", "2026-10-16", 2790, 1), leitura("Z", "2026-10-16", 2490, 2)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toEqual({ situacao: "desfeito" });
  });

  it("nota anterior lida errada e corrigida para o custo da X, sem compra anterior: desfeito", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("X", "2026-10-16", 2790, 1), leitura("Z", "2026-10-16", 2790, 2)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toEqual({ situacao: "desfeito" });
  });

  it("nota anterior corrigida, com compra anterior mais barata: a alta é contra a mais barata, com números novos", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [
        leitura("W", "2026-10-10", 2000),
        leitura("X", "2026-10-16", 2790, 1),
        leitura("Z", "2026-10-16", 2790, 2),
      ],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toMatchObject({
      situacao: "vale",
      metricasApoio: { custo_anterior_centavos: 2000, custo_atual_centavos: 2790, variacao_bps: 3950 },
    });
  });

  it("correção do dono da própria compra para dentro do limite: desfeito", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("W", "2026-10-10", 2490), leitura("X", "2026-10-16", 2500)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toEqual({ situacao: "desfeito" });
  });

  it("no limite exato não é reajuste (mesmo corte da regra)", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("W", "2026-10-10", 10_000), leitura("X", "2026-10-16", 10_500)],
      confiancaDoProduto: 1,
      limites: { ...limites, reajusteLimiteBps: 500 },
    });
    expect(r).toEqual({ situacao: "desfeito" });
  });

  it("queda de custo não é reajuste", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X"),
      custos: [leitura("W", "2026-10-10", 3000), leitura("X", "2026-10-16", 2500)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toEqual({ situacao: "desfeito" });
  });

  it("sem leitura da compra (ou sem id no alerta) não dá para dizer: sem_dado", () => {
    expect(
      recalcularReajuste({
        metricasApoio: apoio("X"),
        custos: [leitura("W", "2026-10-10", 2000)],
        confiancaDoProduto: 1,
        limites,
      }),
    ).toEqual({ situacao: "sem_dado" });
    expect(
      recalcularReajuste({
        metricasApoio: {},
        custos: [leitura("X", "2026-10-16", 2800)],
        confiancaDoProduto: 1,
        limites,
      }),
    ).toEqual({ situacao: "sem_dado" });
  });

  it("a menor confiança entre as leituras, o produto e o giro rebaixa a prioridade e vai para o apoio", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X", { giro_fonte: { menor_confianca: 0.6 } }),
      custos: [leitura("W", "2026-10-10", 2000, 1, 0.9), leitura("X", "2026-10-16", 2800, 2, 0.95)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toMatchObject({ situacao: "vale", metricasApoio: { menor_confianca: 0.6 } });
  });

  it("sem unidades vendidas gravadas, o impacto fica nulo e a prioridade é a mais baixa", () => {
    const r = recalcularReajuste({
      metricasApoio: apoio("X", { unidades_7_dias: undefined }),
      custos: [leitura("W", "2026-10-10", 2000), leitura("X", "2026-10-16", 2800)],
      confiancaDoProduto: 1,
      limites,
    });
    expect(r).toMatchObject({ situacao: "vale", prioridade: 3, metricasApoio: { impacto_centavos: null } });
  });
});
