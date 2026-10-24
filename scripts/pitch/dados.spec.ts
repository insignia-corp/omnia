import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cnpjValido } from "../../src/lib/cnpj/cnpj";
import { normalizarGtin } from "../../src/lib/gtin/gtin";
import {
  CATALOGO_PITCH,
  csvVendasPitch,
  FORNECEDOR_PITCH,
  gerarVendasPitch,
  NOTA_VIDEO,
  NOTAS_ANTERIORES,
  resumirVendasPitch,
} from "./dados";

describe("dados determinísticos do pitch", () => {
  const vendas = gerarVendasPitch();
  it("reproduz os arquivos publicados, sem alterar os fixtures da demo original", () => {
    expect(csvVendasPitch(gerarVendasPitch())).toBe(
      readFileSync(resolve(__dirname, "../../fixtures/pitch/vendas.csv"), "utf8"),
    );
    expect(
      JSON.parse(readFileSync(resolve(__dirname, "../../fixtures/pitch/resumo-diario.json"), "utf8")),
    ).toEqual(resumirVendasPitch(vendas));
  });

  it("soma cada cupom pelos itens, sem dinheiro fracionário ou cupom vazio", () => {
    for (const venda of vendas) {
      expect(venda.itens.length).toBeGreaterThan(0);
      expect(Number.isSafeInteger(venda.total_centavos)).toBe(true);
      expect(venda.total_centavos).toBe(
        venda.itens.reduce((s, i) => s + i.quantidade * i.produto.preco_centavos, 0),
      );
    }
  });

  it("tem 29 códigos válidos e margens entre 25% e 40%, com as duas exceções do roteiro", () => {
    expect(CATALOGO_PITCH).toHaveLength(29);
    expect(new Set(CATALOGO_PITCH.map((p) => p.codigo_barras)).size).toBe(29);
    for (const p of CATALOGO_PITCH) {
      expect(normalizarGtin(p.codigo_barras)).toBe(p.codigo_barras);
      if (["oleo", "arroz"].includes(p.chave)) continue;
      const margem = (p.preco_centavos - p.custo_centavos) / p.preco_centavos;
      expect(margem).toBeGreaterThanOrEqual(0.25);
      expect(margem).toBeLessThanOrEqual(0.4);
    }
  });

  it("a DANFE tem CNPJ válido, soma correta e só o café muda de custo", () => {
    expect(cnpjValido(FORNECEDOR_PITCH.cnpj)).toBe(true);
    const anterior = NOTAS_ANTERIORES.find((n) => n.chave === "sao-jorge")!.extracao;
    expect(NOTA_VIDEO.total_centavos).toBe(53088);
    for (const item of NOTA_VIDEO.itens) {
      const custoAntes = anterior.itens.find((i) => i.descricao === item.descricao)!.valor_unitario_centavos;
      expect(item.valor_unitario_centavos).toBe(item.descricao === "CAFE TORRADO 500G" ? 1870 : custoAntes);
    }
  });
});
