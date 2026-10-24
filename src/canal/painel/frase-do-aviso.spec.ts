import { fraseDoAviso, type EntradaFraseDoAviso, type TrechoDaFrase } from "./frase-do-aviso";

const texto = (trechos: TrechoDaFrase[]): string => trechos.map((x) => x.texto).join("");
const destaques = (trechos: TrechoDaFrase[]): string[] =>
  trechos.filter((x) => x.destaque).map((x) => x.texto);

const entrada = (
  e: Partial<EntradaFraseDoAviso> & Pick<EntradaFraseDoAviso, "tipo">,
): EntradaFraseDoAviso => ({
  rotulo: "Rótulo",
  produto: null,
  fornecedor: null,
  metricasApoio: {},
  ...e,
});

describe("fraseDoAviso", () => {
  it("margem abaixo da meta: produto e margem em destaque, meta em texto", () => {
    const f = fraseDoAviso(
      entrada({
        tipo: "margem_abaixo_da_meta",
        produto: "Arroz 5kg",
        metricasApoio: { margem_bps: 900, meta_bps: 2000 },
      }),
    );
    expect(texto(f)).toBe("Arroz 5kg está vendendo com margem de 9%. Sua meta é 20%.");
    expect(destaques(f)).toEqual(["Arroz 5kg", "9%"]);
  });

  it("reajuste de custo com fornecedor: centavos e bps formatados só com os campos da métrica", () => {
    const f = fraseDoAviso(
      entrada({
        tipo: "reajuste_de_custo",
        produto: "Óleo de soja",
        fornecedor: "Distribuidora Central",
        metricasApoio: { variacao_bps: 1250, custo_anterior_centavos: 645, custo_atual_centavos: 726 },
      }),
    );
    expect(texto(f)).toBe(
      "Distribuidora Central subiu o preço de Óleo de soja em 12,50%, de R$ 6,45 para R$ 7,26.",
    );
    expect(destaques(f)).toEqual(["Distribuidora Central", "Óleo de soja", "12,50%"]);
  });

  it("reajuste de custo sem fornecedor conhecido", () => {
    const f = fraseDoAviso(
      entrada({
        tipo: "reajuste_de_custo",
        produto: "Óleo",
        metricasApoio: { variacao_bps: 1200, custo_anterior_centavos: 100, custo_atual_centavos: 112 },
      }),
    );
    expect(texto(f)).toBe("O custo de Óleo subiu 12%, de R$ 1,00 para R$ 1,12.");
  });

  it("giro em alta, espaço para subir preço e estoque parado", () => {
    expect(
      texto(
        fraseDoAviso(
          entrada({
            tipo: "giro_em_alta",
            produto: "Refri 2L",
            metricasApoio: { alta_bps: 4000, unidades_7_dias: 84 },
          }),
        ),
      ),
    ).toBe(
      "Refri 2L está vendendo mais que o normal: 84 unidades em 7 dias, 40% acima da média. Vale reforçar o estoque.",
    );
    expect(
      texto(
        fraseDoAviso(
          entrada({
            tipo: "espaco_para_subir_preco",
            produto: "Café",
            metricasApoio: { margem_bps: 1100, meta_bps: 2500 },
          }),
        ),
      ),
    ).toBe("Café vende bem e está com margem de 11%, abaixo da meta de 25%. Dá para subir o preço.");
    expect(
      texto(
        fraseDoAviso(
          entrada({ tipo: "estoque_parado", produto: "Vela", metricasApoio: { dias_sem_venda: 45 } }),
        ),
      ),
    ).toBe("Vela está sem venda há 45 dias.");
  });

  it("ticket médio em queda usa a data da métrica", () => {
    expect(
      texto(
        fraseDoAviso(
          entrada({
            tipo: "ticket_medio_em_queda",
            metricasApoio: {
              data: "2026-10-23",
              ticket_medio_centavos: 2100,
              media_28_dias_centavos: 2453,
              queda_bps: 1439,
            },
          }),
        ),
      ),
    ).toBe("O ticket médio de 23/10 foi R$ 21,00, 14,39% abaixo da média de 28 dias (R$ 24,53).");
  });

  it("gasto fora do padrão não tem frase: cai no rótulo (os gastos saíram do painel)", () => {
    const f = fraseDoAviso(
      entrada({
        tipo: "gasto_fora_do_padrao",
        rotulo: "gasto_fora_do_padrao",
        metricasApoio: { data: "2026-10-22", valor_centavos: 123456, mediana_centavos: 30000 },
      }),
    );
    expect(texto(f)).toBe("gasto_fora_do_padrao");
  });

  it("o nome do produto cai no da métrica quando o cadastro não devolve", () => {
    const f = fraseDoAviso(
      entrada({ tipo: "estoque_parado", metricasApoio: { produto_nome: "Vela", dias_sem_venda: 31 } }),
    );
    expect(texto(f)).toBe("Vela está sem venda há 31 dias.");
  });

  it("campo faltando ou fora do tipo: volta ao rótulo com o produto, sem número", () => {
    const f = fraseDoAviso(
      entrada({
        tipo: "margem_abaixo_da_meta",
        rotulo: "Margem abaixo da meta",
        produto: "Arroz",
        metricasApoio: { margem_bps: 9.5, meta_bps: 2000 },
      }),
    );
    expect(texto(f)).toBe("Margem abaixo da meta: Arroz");
    expect(texto(f)).not.toMatch(/\d/);
    expect(
      texto(
        fraseDoAviso(
          entrada({ tipo: "gasto_fora_do_padrao", rotulo: "Gasto fora do padrão", metricasApoio: {} }),
        ),
      ),
    ).toBe("Gasto fora do padrão");
  });

  it("todo número da frase está nos campos da métrica (regra 1)", () => {
    const metricasApoio = { variacao_bps: 1234, custo_anterior_centavos: 999, custo_atual_centavos: 1122 };
    const f = fraseDoAviso(
      entrada({ tipo: "reajuste_de_custo", produto: "P", fornecedor: "F", metricasApoio }),
    );
    const numeros = texto(f).match(/\d[\d.,]*/g) ?? [];
    expect(numeros.map((n) => n.replace(/[.,]/g, "").replace(/^0+/, ""))).toEqual(["1234", "999", "1122"]);
  });
});
