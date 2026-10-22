import { NumerosAutorizados, verificarNumeros } from "../lib/verificador-numeros/verificador-numeros";
import type { CustoDeCompra, ProdutoParaMetrica, VendaDoProdutoNoDia } from "./dados-de-metricas";
import {
  calcularMargemDoProduto,
  PARAMETROS_MARGEM,
  precoParaMeta,
  type EntradaMargem,
} from "./margem-por-produto";
import { ehDadoAusente } from "./resultado-metrica";

const REF = "2026-10-19";

const arroz: ProdutoParaMetrica = {
  id: "p-arroz",
  nome: "Arroz 5kg",
  margemMetaBps: null,
  origem: "dono",
  confianca: 1,
};

const venda = (data: string, quantidade: number, receitaCentavos: number): VendaDoProdutoNoDia => ({
  data,
  produtoId: "p-arroz",
  quantidade,
  receitaCentavos,
  registros: 1,
  menorConfianca: 1,
  origens: ["planilha"],
});

const custo = (data: string, centavos: number, extra: Partial<CustoDeCompra> = {}): CustoDeCompra => ({
  produtoId: "p-arroz",
  fornecedorId: "f-aurora",
  compraId: `compra-${data}`,
  itemDeCompraId: `item-${data}`,
  data,
  custoUnitarioCentavos: centavos,
  confianca: 1,
  origem: "foto_nota",
  criadoEm: new Date(`${data}T12:00:00Z`),
  ...extra,
});

const entrada = (extra: Partial<EntradaMargem> = {}): EntradaMargem => ({
  produto: arroz,
  margemMetaComercianteBps: 2500,
  vendas: [venda("2026-10-18", 10, 35_000)],
  custos: [custo("2026-10-10", 2790)],
  dataReferencia: REF,
  ...extra,
});

function valorDe(entradaMargem: EntradaMargem) {
  const r = calcularMargemDoProduto(entradaMargem);
  if (ehDadoAusente(r)) throw new Error(`Esperava margem, veio dado ausente: ${r.codigo}`);
  return r;
}

describe("precoParaMeta", () => {
  it("arredonda para cima, para a margem nunca ficar abaixo da meta", () => {
    expect(precoParaMeta(2790, 2500)).toBe(3720);
    expect(precoParaMeta(560, 2500)).toBe(747); // 746,67 vira 747
    expect(precoParaMeta(1000, 0)).toBe(1000);
  });

  it("não existe preço para meta de 100% ou mais", () => {
    expect(precoParaMeta(1000, 10_000)).toBeNull();
    expect(precoParaMeta(1000, 12_000)).toBeNull();
  });
});

describe("calcularMargemDoProduto", () => {
  it("calcula a margem pelo preço médio de venda e pelo custo da compra mais recente", () => {
    // 10 unidades por R$ 350,00 dão preço médio de R$ 35,00; custo R$ 27,90.
    const r = valorDe(entrada());
    expect(r.valor).toMatchObject({
      produto_id: "p-arroz",
      preco_medio_venda_centavos: 3500,
      unidades_vendidas: 10,
      custo_compra_mais_recente_centavos: 2790,
      compra_data: "2026-10-10",
      fornecedor_id: "f-aurora",
      margem_bps: 2029, // 710 / 3500 = 20,2857%
      margem_percentual: 20.29,
    });
  });

  it("reproduz a margem do arroz do gabarito: preço 34,99 e custo 27,90 dão 20,26%", () => {
    const r = valorDe(
      entrada({ vendas: [venda("2026-10-18", 150, 150 * 3499)], custos: [custo("2026-10-16", 2790)] }),
    );
    expect(r.valor.preco_medio_venda_centavos).toBe(3499);
    expect(r.valor.margem_bps).toBe(2026);
    expect(r.valor.margem_percentual).toBe(20.26);
    // Custo 27,90 com meta de 25%: 27,90 / 0,75 = 37,20, o preço do roteiro do pitch.
    expect(r.valor.preco_para_meta_centavos).toBe(3720);
  });

  it("arredonda o preço médio em centavos, meio para cima", () => {
    // 3 unidades por 1000 centavos: 333,33 centavos cada, arredonda para 333.
    expect(
      valorDe(entrada({ vendas: [venda("2026-10-18", 3, 1000)] })).valor.preco_medio_venda_centavos,
    ).toBe(333);
    // 2 unidades por 1001 centavos: 500,5 centavos cada, arredonda para 501.
    expect(
      valorDe(entrada({ vendas: [venda("2026-10-18", 2, 1001)] })).valor.preco_medio_venda_centavos,
    ).toBe(501);
  });

  it("pondera o preço pelas unidades, não pela média dos dias", () => {
    // 1 un a R$ 10,00 e 9 un a R$ 20,00: média ponderada R$ 19,00 (não R$ 15,00).
    const r = valorDe(entrada({ vendas: [venda("2026-10-17", 1, 1000), venda("2026-10-18", 9, 18_000)] }));
    expect(r.valor.preco_medio_venda_centavos).toBe(1900);
  });

  it("usa o custo da compra mais recente, de qualquer fornecedor", () => {
    const r = valorDe(
      entrada({
        custos: [
          custo("2026-09-14", 2490),
          custo("2026-10-16", 2790, { fornecedorId: "f-aurora" }),
          custo("2026-10-12", 2650, { fornecedorId: "f-mix" }),
        ],
      }),
    );
    expect(r.valor.custo_compra_mais_recente_centavos).toBe(2790);
    expect(r.valor.compra_data).toBe("2026-10-16");
  });

  it("ignora custo de data posterior à referência", () => {
    const r = valorDe(entrada({ custos: [custo("2026-10-10", 2790), custo("2026-10-25", 9999)] }));
    expect(r.valor.custo_compra_mais_recente_centavos).toBe(2790);
  });

  it("na mesma data de compra, vale a leitura registrada por último", () => {
    const r = valorDe(
      entrada({
        custos: [
          custo("2026-10-10", 2700, { itemDeCompraId: "a", criadoEm: new Date("2026-10-10T12:00:00Z") }),
          custo("2026-10-10", 2790, { itemDeCompraId: "b", criadoEm: new Date("2026-10-10T18:00:00Z") }),
        ],
      }),
    );
    expect(r.valor.custo_compra_mais_recente_centavos).toBe(2790);
  });

  describe("janela de preço", () => {
    it("inclui o primeiro dia da janela de 30 dias e exclui o dia anterior", () => {
      // 2026-10-19 menos 29 dias é 2026-09-20.
      const r = valorDe(
        entrada({
          vendas: [venda("2026-09-19", 100, 100 * 9999), venda("2026-09-20", 10, 10 * 3500)],
        }),
      );
      expect(r.periodo).toEqual({ inicio: "2026-09-20", fim: REF });
      expect(r.valor.unidades_vendidas).toBe(10);
      expect(r.valor.preco_medio_venda_centavos).toBe(3500);
    });

    it("ignora venda depois da data de referência", () => {
      const r = valorDe(
        entrada({ vendas: [venda("2026-10-18", 10, 35_000), venda("2026-10-20", 5, 99_999)] }),
      );
      expect(r.valor.unidades_vendidas).toBe(10);
    });

    it("aceita outra janela pelos parâmetros", () => {
      const r = calcularMargemDoProduto(
        entrada({ vendas: [venda("2026-10-10", 10, 10 * 5000), venda("2026-10-18", 10, 10 * 3500)] }),
        { janelaPrecoDias: 3 },
      );
      if (ehDadoAusente(r)) throw new Error("esperava margem");
      expect(r.valor.preco_medio_venda_centavos).toBe(3500);
      expect(PARAMETROS_MARGEM.janelaPrecoDias).toBe(30);
    });
  });

  describe("meta de margem", () => {
    it("usa a meta do comerciante quando o produto não tem a própria", () => {
      const r = valorDe(entrada({ margemMetaComercianteBps: 2500 }));
      expect(r.valor).toMatchObject({ meta_bps: 2500, meta_percentual: 25, abaixo_da_meta: true });
    });

    it("a meta do produto prevalece sobre a do comerciante", () => {
      const r = valorDe(
        entrada({ produto: { ...arroz, margemMetaBps: 1500 }, margemMetaComercianteBps: 2500 }),
      );
      expect(r.valor).toMatchObject({ meta_bps: 1500, meta_percentual: 15, abaixo_da_meta: false });
    });

    it("margem igual à meta não está abaixo dela", () => {
      const r = valorDe(entrada({ produto: { ...arroz, margemMetaBps: 2029 } }));
      expect(r.valor.margem_bps).toBe(2029);
      expect(r.valor.abaixo_da_meta).toBe(false);
    });

    it("meta zero é uma meta (não cai na do comerciante)", () => {
      const r = valorDe(entrada({ produto: { ...arroz, margemMetaBps: 0 } }));
      expect(r.valor.meta_bps).toBe(0);
    });
  });

  it("margem negativa quando o custo passa do preço", () => {
    const r = valorDe(entrada({ custos: [custo("2026-10-10", 4000)] }));
    expect(r.valor.margem_bps).toBe(-1429); // (3500 - 4000) / 3500
    expect(r.valor.abaixo_da_meta).toBe(true);
  });

  describe("procedência dos dados", () => {
    it("conta as linhas de venda e o custo, e herda a menor confiança", () => {
      const r = valorDe(
        entrada({
          vendas: [venda("2026-10-17", 4, 14_000), { ...venda("2026-10-18", 6, 21_000), registros: 3 }],
          custos: [custo("2026-10-10", 2790, { confianca: 0.5, origem: "dono" })],
        }),
      );
      expect(r.n_registros).toBe(5); // 1 + 3 linhas de venda e 1 de custo
      expect(r.menor_confianca).toBe(0.5);
      expect(r.origens).toEqual(["dono", "planilha"]);
    });

    it("a confiança da venda também entra", () => {
      const r = valorDe(entrada({ vendas: [{ ...venda("2026-10-18", 10, 35_000), menorConfianca: 0.7 }] }));
      expect(r.menor_confianca).toBe(0.7);
    });

    it("a confiança e a origem do cadastro do produto entram, sem virar registro", () => {
      const r = valorDe(
        entrada({
          produto: { ...arroz, origem: "foto_nota", confianca: 0.6 },
          vendas: [venda("2026-10-18", 10, 35_000)],
          custos: [custo("2026-10-10", 2790)],
        }),
      );
      expect(r.menor_confianca).toBe(0.6);
      expect(r.origens).toEqual(["foto_nota", "planilha"]);
      expect(r.n_registros).toBe(2); // 1 venda e 1 custo: o cadastro não conta
    });

    it("não conta venda fora da janela", () => {
      const r = valorDe(entrada({ vendas: [venda("2026-08-01", 5, 5000), venda("2026-10-18", 10, 35_000)] }));
      expect(r.n_registros).toBe(2);
    });
  });

  describe("contrato com o verificador de números (regra inviolável 8)", () => {
    // Preço médio de R$ 34,99 e custo de R$ 27,90: margem de 20,26% contra a meta de 25%.
    const r = valorDe(
      entrada({ vendas: [venda("2026-10-18", 150, 150 * 3499)], custos: [custo("2026-10-16", 2790)] }),
    );
    const autorizados = new NumerosAutorizados([r]);

    it("aprova a mensagem que cita só números do resultado", () => {
      const mensagem =
        "A margem do Arroz 5kg está em 20,26%, abaixo da meta de 25%: vende a R$ 34,99 e custa R$ 27,90.";
      expect(verificarNumeros(mensagem, autorizados).aprovado).toBe(true);
    });

    it("bloqueia o percentual que o modelo arredondou por conta própria", () => {
      const resultado = verificarNumeros("A margem do Arroz 5kg está em 20,3%.", autorizados);
      expect(resultado.aprovado).toBe(false);
      expect(resultado.naoAutorizados.map((n) => n.valor)).toEqual([20.3]);
    });

    it("bloqueia o número que o modelo calculou: o lucro por unidade não está no resultado", () => {
      const resultado = verificarNumeros("Sobram R$ 7,09 por pacote.", autorizados);
      expect(resultado.aprovado).toBe(false);
      expect(resultado.naoAutorizados.map((n) => n.valor)).toEqual([7.09]);
    });
  });

  describe("dado ausente", () => {
    it("sem nota de compra: código sem_custo e pergunta ao dono", () => {
      const r = calcularMargemDoProduto(entrada({ custos: [] }));
      expect(r).toMatchObject({
        ausente: true,
        codigo: "sem_custo",
        pergunta_sugerida: "Qual é o custo de compra de Arroz 5kg?",
      });
    });

    it("só custo posterior à referência conta como sem custo", () => {
      const r = calcularMargemDoProduto(entrada({ custos: [custo("2026-10-25", 2790)] }));
      expect(r).toMatchObject({ ausente: true, codigo: "sem_custo" });
    });

    it("sem venda na janela: código sem_venda_na_janela", () => {
      const r = calcularMargemDoProduto(entrada({ vendas: [venda("2026-08-24", 5, 5000)] }));
      expect(r).toMatchObject({ ausente: true, codigo: "sem_venda_na_janela" });
    });

    it("sem custo e sem venda: o custo vem primeiro, porque é o que o dono pode informar", () => {
      const r = calcularMargemDoProduto(entrada({ custos: [], vendas: [] }));
      expect(r).toMatchObject({ ausente: true, codigo: "sem_custo" });
    });

    it("preço médio zero não divide por zero", () => {
      const r = calcularMargemDoProduto(entrada({ vendas: [venda("2026-10-18", 10, 0)] }));
      expect(r).toMatchObject({ ausente: true, codigo: "preco_medio_zero" });
    });
  });
});
