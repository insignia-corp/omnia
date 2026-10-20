import {
  compararCustos,
  compararNomes,
  compararTexto,
  custoMaisRecente,
  type CustoDeCompra,
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

describe("dados-de-metricas", () => {
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
