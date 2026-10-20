import {
  compararCustos,
  compararNomes,
  compararTexto,
  custoMaisRecente,
  indexarVendasPorDia,
  type CustoDeCompra,
  type VendasDoDia,
} from "./dados-de-metricas";

const custo = (data: string, centavos: number, extra: Partial<CustoDeCompra> = {}): CustoDeCompra => ({
  produtoId: "p",
  fornecedorId: "f",
  compraId: `compra-${data}`,
  itemDeCompraId: `item-${data}`,
  data,
  custoUnitarioCentavos: centavos,
  confianca: 1,
  origem: "foto_nota",
  criadoEm: new Date(`${data}T12:00:00Z`),
  ...extra,
});

const vendasDoDia = (data: string, cupons: number): VendasDoDia => ({
  data,
  cupons,
  faturamentoCentavos: cupons * 1000,
  registros: cupons,
  menorConfianca: 1,
  origens: ["planilha"],
});

describe("dados-de-metricas", () => {
  describe("indexarVendasPorDia", () => {
    const vendas = [vendasDoDia("2026-10-17", 5), vendasDoDia("2026-10-19", 8)];
    const intervalo = { primeira: "2026-10-15", ultima: "2026-10-19" };

    it("devolve a linha do dia", () => {
      expect(indexarVendasPorDia(vendas, intervalo)("2026-10-19")).toBe(vendas[1]);
    });

    it("dia dentro do intervalo sem linha é dia sem venda: zero cupom e nenhuma procedência", () => {
      expect(indexarVendasPorDia(vendas, intervalo)("2026-10-18")).toEqual({
        data: "2026-10-18",
        cupons: 0,
        faturamentoCentavos: 0,
        registros: 0,
        menorConfianca: null,
        origens: [],
      });
    });

    it("as duas pontas do intervalo estão dentro", () => {
      const vendasDe = indexarVendasPorDia(vendas, intervalo);
      expect(vendasDe("2026-10-15")).not.toBeNull();
      expect(vendasDe("2026-10-19")).not.toBeNull();
    });

    it("dia fora do intervalo é dia sem dado: nulo, nunca zero", () => {
      const vendasDe = indexarVendasPorDia(vendas, intervalo);
      expect(vendasDe("2026-10-14")).toBeNull();
      expect(vendasDe("2026-10-20")).toBeNull();
    });

    it("sem intervalo nenhum dia tem dado", () => {
      expect(indexarVendasPorDia(vendas, null)("2026-10-19")).toBeNull();
    });
  });

  describe("compararTexto", () => {
    it("ordena por código de caractere, sem localidade", () => {
      expect(compararTexto("2026-10-01", "2026-10-02")).toBe(-1);
      expect(compararTexto("b", "a")).toBe(1);
      expect(compararTexto("a", "a")).toBe(0);
    });
  });

  describe("compararNomes", () => {
    it("ordena alfabeticamente em português, com acento junto da letra", () => {
      const nomes = ["Zebra", "Ovos", "Água", "Açúcar", "Arroz", "Óleo"];
      expect([...nomes].sort(compararNomes)).toEqual(["Açúcar", "Água", "Arroz", "Óleo", "Ovos", "Zebra"]);
    });

    it("não diferencia maiúscula na ordem principal", () => {
      expect(compararNomes("arroz", "Feijão")).toBeLessThan(0);
    });
  });

  describe("compararCustos", () => {
    it("ordena por data, depois por criação, depois por id do item", () => {
      const a = custo("2026-10-10", 100, { itemDeCompraId: "a" });
      const b = custo("2026-10-11", 100, { itemDeCompraId: "a" });
      expect(compararCustos(a, b)).toBeLessThan(0);

      const cedo = custo("2026-10-10", 100, { criadoEm: new Date("2026-10-10T08:00:00Z") });
      const tarde = custo("2026-10-10", 100, { criadoEm: new Date("2026-10-10T18:00:00Z") });
      expect(compararCustos(cedo, tarde)).toBeLessThan(0);

      const x = custo("2026-10-10", 100, { itemDeCompraId: "x" });
      const y = custo("2026-10-10", 100, { itemDeCompraId: "y" });
      expect(compararCustos(x, y)).toBeLessThan(0);
      expect(compararCustos(x, x)).toBe(0);
    });
  });

  describe("custoMaisRecente", () => {
    it("devolve a leitura de data mais recente", () => {
      const r = custoMaisRecente(
        [custo("2026-09-14", 2490), custo("2026-10-16", 2790), custo("2026-10-01", 2600)],
        "2026-10-19",
      );
      expect(r?.custoUnitarioCentavos).toBe(2790);
    });

    it("ignora leituras depois da data pedida", () => {
      const r = custoMaisRecente([custo("2026-09-14", 2490), custo("2026-10-25", 9999)], "2026-10-19");
      expect(r?.custoUnitarioCentavos).toBe(2490);
    });

    it("inclui a leitura do próprio dia", () => {
      expect(custoMaisRecente([custo("2026-10-19", 2790)], "2026-10-19")?.custoUnitarioCentavos).toBe(2790);
    });

    it("devolve null sem leitura até a data", () => {
      expect(custoMaisRecente([], "2026-10-19")).toBeNull();
      expect(custoMaisRecente([custo("2026-10-25", 1)], "2026-10-19")).toBeNull();
    });

    it("não depende da ordem da lista", () => {
      const lista = [custo("2026-09-14", 1), custo("2026-10-16", 2), custo("2026-10-01", 3)];
      expect(custoMaisRecente([...lista].reverse(), "2026-10-19")?.custoUnitarioCentavos).toBe(2);
      expect(custoMaisRecente(lista, "2026-10-19")?.custoUnitarioCentavos).toBe(2);
    });
  });
});
