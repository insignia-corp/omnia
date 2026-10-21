import { NumerosAutorizados, verificarNumeros } from "../lib/verificador-numeros/verificador-numeros";
import type { CustoDeCompra, ProdutoParaMetrica } from "./dados-de-metricas";
import {
  calcularVariacoesDeCusto,
  PARAMETROS_VARIACAO_CUSTO,
  type EntradaVariacaoDeCusto,
} from "./variacao-de-custo";

const REF = "2026-10-19";

const produtos: ProdutoParaMetrica[] = [
  { id: "p-arroz", nome: "Arroz 5kg", margemMetaBps: null, origem: "dono", confianca: 1 },
  { id: "p-oleo", nome: "Óleo 900ml", margemMetaBps: null, origem: "dono", confianca: 1 },
  { id: "p-cafe", nome: "Café 500g", margemMetaBps: null, origem: "dono", confianca: 1 },
];

const custo = (
  produtoId: string,
  data: string,
  centavos: number,
  extra: Partial<CustoDeCompra> = {},
): CustoDeCompra => ({
  produtoId,
  fornecedorId: "f-aurora",
  compraId: `compra-${data}`,
  itemDeCompraId: `item-${produtoId}-${data}`,
  data,
  custoUnitarioCentavos: centavos,
  confianca: 1,
  origem: "foto_nota",
  criadoEm: new Date(`${data}T12:00:00Z`),
  ...extra,
});

const calcular = (custos: CustoDeCompra[], extra: Partial<EntradaVariacaoDeCusto> = {}) =>
  calcularVariacoesDeCusto({ produtos, custos, dataReferencia: REF, ...extra });

describe("calcularVariacoesDeCusto", () => {
  it("detecta o reajuste plantado: arroz de R$ 24,90 para R$ 27,90 é +12,05%", () => {
    const r = calcular([custo("p-arroz", "2026-09-14", 2490), custo("p-arroz", "2026-10-16", 2790)]);
    expect(r.valor).toEqual([
      {
        produto_id: "p-arroz",
        nome: "Arroz 5kg",
        fornecedor_id: "f-aurora",
        custo_anterior_centavos: 2490,
        custo_atual_centavos: 2790,
        compra_anterior_data: "2026-09-14",
        compra_atual_data: "2026-10-16",
        compra_atual_id: "compra-2026-10-16",
        variacao_bps: 1205,
        variacao_percentual: 12.05,
        acima_do_limite: true,
        recente: true,
        menor_confianca: 1,
      },
    ]);
  });

  it("não acusa nada nos produtos sem reajuste", () => {
    const r = calcular([
      custo("p-arroz", "2026-09-14", 2490),
      custo("p-arroz", "2026-10-16", 2490),
      custo("p-oleo", "2026-09-14", 520),
    ]);
    expect(r.valor).toEqual([]);
  });

  it("usa só as duas últimas compras do par", () => {
    const r = calcular([
      custo("p-arroz", "2026-08-01", 1000),
      custo("p-arroz", "2026-09-14", 2490),
      custo("p-arroz", "2026-10-16", 2790),
    ]);
    expect(r.valor).toHaveLength(1);
    expect(r.valor[0]).toMatchObject({ custo_anterior_centavos: 2490, custo_atual_centavos: 2790 });
  });

  describe("mesmo produto e mesmo fornecedor", () => {
    it("custo diferente em outro fornecedor não é reajuste", () => {
      // Arroz 5kg: Aurora a R$ 24,90, Atacado Mix a R$ 27,50 numa única compra.
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490),
        custo("p-arroz", "2026-10-10", 2750, { fornecedorId: "f-mix" }),
      ]);
      expect(r.valor).toEqual([]);
    });

    it("compara cada fornecedor com ele mesmo", () => {
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490),
        custo("p-arroz", "2026-10-16", 2790),
        custo("p-arroz", "2026-09-20", 2500, { fornecedorId: "f-mix" }),
        custo("p-arroz", "2026-10-12", 2500, { fornecedorId: "f-mix" }),
      ]);
      expect(r.valor.map((v) => v.fornecedor_id)).toEqual(["f-aurora"]);
    });
  });

  describe("limite de 5%", () => {
    it("exatamente 5% não passa do limite", () => {
      const r = calcular([custo("p-arroz", "2026-09-14", 2000), custo("p-arroz", "2026-10-16", 2100)]);
      expect(r.valor[0]).toMatchObject({ variacao_bps: 500, acima_do_limite: false });
    });

    it("um ponto-base acima passa", () => {
      const r = calcular([custo("p-arroz", "2026-09-14", 20_000), custo("p-arroz", "2026-10-16", 21_001)]);
      expect(r.valor[0]).toMatchObject({ variacao_bps: 501, acima_do_limite: true });
    });

    it("queda de custo é variação negativa e nunca passa do limite", () => {
      const r = calcular([custo("p-cafe", "2026-09-14", 1290), custo("p-cafe", "2026-10-13", 1250)]);
      expect(r.valor[0]).toMatchObject({
        variacao_bps: -310,
        variacao_percentual: -3.1,
        acima_do_limite: false,
      });
    });

    it("aceita outro limite pelos parâmetros", () => {
      const r = calcularVariacoesDeCusto(
        {
          produtos,
          custos: [custo("p-arroz", "2026-09-14", 2000), custo("p-arroz", "2026-10-16", 2100)],
          dataReferencia: REF,
        },
        { ...PARAMETROS_VARIACAO_CUSTO, limiteBps: 400 },
      );
      expect(r.valor[0]?.acima_do_limite).toBe(true);
    });
  });

  describe("compra recente", () => {
    it("compra a 7 dias da referência é recente; a 8 dias, não", () => {
      const sete = calcular([custo("p-arroz", "2026-09-01", 2000), custo("p-arroz", "2026-10-12", 2400)]);
      const oito = calcular([custo("p-arroz", "2026-09-01", 2000), custo("p-arroz", "2026-10-11", 2400)]);
      expect(sete.valor[0]?.recente).toBe(true);
      expect(oito.valor[0]?.recente).toBe(false);
    });
  });

  describe("ordem e limites da série", () => {
    it("lista da maior alta para a maior queda", () => {
      const r = calcular([
        custo("p-cafe", "2026-09-14", 1290),
        custo("p-cafe", "2026-10-13", 1250),
        custo("p-oleo", "2026-09-14", 520),
        custo("p-oleo", "2026-10-13", 560),
        custo("p-arroz", "2026-09-14", 2490),
        custo("p-arroz", "2026-10-16", 2790),
      ]);
      expect(r.valor.map((v) => v.produto_id)).toEqual(["p-arroz", "p-oleo", "p-cafe"]);
    });

    it("empate de variação desempata pelo nome do produto", () => {
      const r = calcular([
        custo("p-oleo", "2026-09-14", 1000),
        custo("p-oleo", "2026-10-13", 1100),
        custo("p-arroz", "2026-09-14", 1000),
        custo("p-arroz", "2026-10-13", 1100),
      ]);
      expect(r.valor.map((v) => v.nome)).toEqual(["Arroz 5kg", "Óleo 900ml"]);
    });

    it("ignora compra posterior à data de referência", () => {
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490),
        custo("p-arroz", "2026-10-16", 2790),
        custo("p-arroz", "2026-10-25", 9999),
      ]);
      expect(r.valor[0]?.custo_atual_centavos).toBe(2790);
    });

    it("custo anterior zero não gera variação infinita", () => {
      const r = calcular([custo("p-arroz", "2026-09-14", 0), custo("p-arroz", "2026-10-16", 2790)]);
      expect(r.valor).toEqual([]);
    });
  });

  describe("duas compras do mesmo produto e fornecedor no mesmo dia", () => {
    it("a variação traz o id da compra atual, a mais recente do dia", () => {
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490),
        custo("p-arroz", "2026-10-16", 2790, {
          compraId: "nota-a",
          criadoEm: new Date("2026-10-16T09:00:00Z"),
        }),
        custo("p-arroz", "2026-10-16", 3000, {
          compraId: "nota-b",
          criadoEm: new Date("2026-10-16T15:00:00Z"),
        }),
      ]);
      expect(r.valor).toHaveLength(1);
      expect(r.valor[0]).toMatchObject({ compra_atual_id: "nota-b", custo_anterior_centavos: 2790 });
    });
  });

  describe("mesma nota com o produto em duas linhas", () => {
    it("a compra anterior é de outra nota", () => {
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490),
        // Duas linhas do arroz na mesma nota de 16/10, com custos diferentes.
        custo("p-arroz", "2026-10-16", 2790, { compraId: "nota-16", itemDeCompraId: "i-1" }),
        custo("p-arroz", "2026-10-16", 2600, {
          compraId: "nota-16",
          itemDeCompraId: "i-2",
          criadoEm: new Date("2026-10-16T13:00:00Z"),
        }),
      ]);
      expect(r.valor).toHaveLength(1);
      expect(r.valor[0]).toMatchObject({ compra_anterior_data: "2026-09-14", custo_anterior_centavos: 2490 });
    });

    it("sem outra nota não há variação", () => {
      const r = calcular([
        custo("p-arroz", "2026-10-16", 2790, { compraId: "nota-16", itemDeCompraId: "i-1" }),
        custo("p-arroz", "2026-10-16", 2600, { compraId: "nota-16", itemDeCompraId: "i-2" }),
      ]);
      expect(r.valor).toEqual([]);
    });
  });

  describe("contrato com o verificador de números (regra inviolável 8)", () => {
    const r = calcular([custo("p-arroz", "2026-09-14", 2490), custo("p-arroz", "2026-10-16", 2790)]);
    const autorizados = new NumerosAutorizados([r]);

    it("aprova a mensagem que cita só números do resultado", () => {
      const mensagem = "O Arroz 5kg subiu 12,05%: de R$ 24,90 para R$ 27,90.";
      expect(verificarNumeros(mensagem, autorizados).aprovado).toBe(true);
    });

    it("bloqueia o percentual arredondado pelo modelo", () => {
      const resultado = verificarNumeros("O Arroz 5kg subiu 12%.", autorizados);
      expect(resultado.aprovado).toBe(false);
      expect(resultado.naoAutorizados.map((n) => n.valor)).toEqual([12]);
    });
  });

  describe("procedência dos dados", () => {
    it("cada variação carrega a menor confiança das suas duas compras", () => {
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490, { confianca: 0.6 }),
        custo("p-arroz", "2026-10-16", 2790),
        custo("p-oleo", "2026-09-14", 520),
        custo("p-oleo", "2026-10-13", 560, { confianca: 0.9 }),
      ]);
      expect(r.valor.map((v) => [v.produto_id, v.menor_confianca])).toEqual([
        ["p-arroz", 0.6],
        ["p-oleo", 0.9],
      ]);
    });

    it("a confiança do cadastro do produto entra na variação e no resultado", () => {
      const r = calcular(
        [
          custo("p-arroz", "2026-09-14", 2490),
          custo("p-arroz", "2026-10-16", 2790),
          custo("p-oleo", "2026-09-14", 520),
          custo("p-oleo", "2026-10-13", 560),
        ],
        {
          produtos: [
            { id: "p-arroz", nome: "Arroz 5kg", margemMetaBps: null, origem: "foto_nota", confianca: 0.5 },
            { id: "p-oleo", nome: "Óleo 900ml", margemMetaBps: null, origem: "dono", confianca: 1 },
          ],
        },
      );
      expect(r.valor.map((v) => [v.produto_id, v.menor_confianca])).toEqual([
        ["p-arroz", 0.5],
        ["p-oleo", 1],
      ]);
      expect(r.menor_confianca).toBe(0.5);
    });

    it("conta as duas leituras de cada variação, herda a menor confiança e junta as origens", () => {
      const r = calcular([
        custo("p-arroz", "2026-09-14", 2490, { confianca: 0.6 }),
        custo("p-arroz", "2026-10-16", 2790, { origem: "nfe" }),
        custo("p-oleo", "2026-09-14", 520),
        custo("p-oleo", "2026-10-13", 560),
      ]);
      expect(r.n_registros).toBe(4);
      expect(r.menor_confianca).toBe(0.6);
      expect(r.origens).toEqual(["dono", "foto_nota", "nfe"]);
      expect(r.periodo).toEqual({ inicio: "2026-09-14", fim: REF });
    });

    it("sem variação, o período é só a data de referência e nenhum registro conta", () => {
      const r = calcular([]);
      expect(r).toEqual({
        valor: [],
        periodo: { inicio: REF, fim: REF },
        n_registros: 0,
        menor_confianca: null,
        origens: [],
      });
    });
  });
});
