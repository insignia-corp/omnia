import { randomUUID } from "node:crypto";
import type { MetricasService } from "../../../metricas/metricas.service";
import type { ContextoSessao } from "../ferramenta";
import { criarGetDailySummary } from "./get-daily-summary";
import { criarGetPeriodSummary } from "./get-period-summary";
import { criarGetTopProducts } from "./get-top-products";

/**
 * Período padrão das ferramentas do agente: a data de referência ainda não tem vendas completas, então
 * as janelas e o resumo do dia sem data terminam ontem, como no painel.
 */
const contexto: ContextoSessao = {
  comercianteId: randomUUID(),
  nomeComercio: "Mercadinho Teste",
  dataReferencia: "2026-10-20",
};
const ausente = { ausente: true as const, codigo: "cobertura_insuficiente", motivo: "teste" };

const servico = () => {
  const mock = {
    resumoDePeriodo: jest.fn(async () => ausente),
    resumoDiario: jest.fn(async () => ausente),
    giro: jest.fn(async () => ausente),
    receitaPorProduto: jest.fn(async () => ausente),
  };
  return { mock, metricas: mock as unknown as MetricasService };
};

describe("período padrão das ferramentas do agente", () => {
  it("get_daily_summary sem data resume ontem; com data, o dia pedido", async () => {
    const { mock, metricas } = servico();
    const ferramenta = criarGetDailySummary(metricas);
    await ferramenta.executar(contexto, {});
    await ferramenta.executar(contexto, { data: "2026-10-15" });
    expect(mock.resumoDiario).toHaveBeenNthCalledWith(1, contexto, "2026-10-19");
    expect(mock.resumoDiario).toHaveBeenNthCalledWith(2, contexto, "2026-10-15");
  });

  it("get_period_summary sem `ate` termina ontem, para a semana e para o mês", async () => {
    const { mock, metricas } = servico();
    const ferramenta = criarGetPeriodSummary(metricas);
    await ferramenta.executar(contexto, { periodo: "semana" });
    await ferramenta.executar(contexto, { periodo: "mes" });
    expect(mock.resumoDePeriodo).toHaveBeenNthCalledWith(1, contexto, "semana", "2026-10-19");
    expect(mock.resumoDePeriodo).toHaveBeenNthCalledWith(2, contexto, "mes", "2026-10-19");
  });

  it("get_period_summary com `ate` explícito usa a data pedida, sem deslocar", async () => {
    const { mock, metricas } = servico();
    await criarGetPeriodSummary(metricas).executar(contexto, { periodo: "semana", ate: "2026-10-20" });
    expect(mock.resumoDePeriodo).toHaveBeenCalledWith(contexto, "semana", "2026-10-20");
  });

  it("get_period_summary atravessa a virada de mês: referência 01/11 termina em 31/10", async () => {
    const { mock, metricas } = servico();
    const virada = { ...contexto, dataReferencia: "2026-11-01" };
    await criarGetPeriodSummary(metricas).executar(virada, { periodo: "mes" });
    expect(mock.resumoDePeriodo).toHaveBeenCalledWith(virada, "mes", "2026-10-31");
  });

  it.each(["volume", "alta"] as const)(
    "get_top_products %s mede o giro com a janela até ontem",
    async (criterio) => {
      const { mock, metricas } = servico();
      await criarGetTopProducts(metricas).executar(contexto, { criterio });
      expect(mock.giro).toHaveBeenCalledWith({ ...contexto, dataReferencia: "2026-10-19" });
      expect(mock.receitaPorProduto).not.toHaveBeenCalled();
    },
  );

  it("get_top_products receita mede a receita dos 7 dias até ontem", async () => {
    const { mock, metricas } = servico();
    await criarGetTopProducts(metricas).executar(contexto, { criterio: "receita" });
    expect(mock.receitaPorProduto).toHaveBeenCalledWith({ ...contexto, dataReferencia: "2026-10-19" });
    expect(mock.giro).not.toHaveBeenCalled();
  });

  it("o comerciante da sessão segue no contexto das métricas, e a entrada não tem comerciante_id", async () => {
    const { mock, metricas } = servico();
    await criarGetTopProducts(metricas).executar(contexto, { criterio: "volume" });
    expect(mock.giro).toHaveBeenCalledWith(
      expect.objectContaining({ comercianteId: contexto.comercianteId }),
    );
    expect(Object.keys(criarGetTopProducts(metricas).entrada.shape)).toEqual(["criterio"]);
    expect(Object.keys(criarGetPeriodSummary(metricas).entrada.shape)).toEqual(["periodo", "ate"]);
  });
});
