import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extracaoNotaSchema, LIMITE_CONFIANCA_ITEM } from "../../src/ingestao/extracao/esquema-extracao";
import { DATA_REFERENCIA, INICIO_JANELA, NOTAS, PRODUTOS } from "./dados-base";
import { montarMercadinho, type ProdutoFixture, type FornecedorFixture } from "./mercadinho";
import { montarNotas, montarXmlNfe, type ManifestoNota } from "./notas";
import { montarPerguntas } from "./perguntas";
import { montarVendas, montarVendasCsv } from "./vendas";
import { cnpjValido, DIR_AVALIACAO, DIR_GABARITO, DIR_MERCADINHO, DIR_NOTAS, diasEntre, ean13Valido } from "./lib/util";

const lerJson = <T>(caminho: string): T => JSON.parse(readFileSync(caminho, "utf8")) as T;
const manifesto = () => lerJson<ManifestoNota[]>(resolve(DIR_NOTAS, "manifesto.json"));

describe("mercadinho de teste (#12)", () => {
  const catalogo = lerJson<ProdutoFixture[]>(resolve(DIR_MERCADINHO, "catalogo.json"));
  const fornecedores = lerJson<FornecedorFixture[]>(resolve(DIR_MERCADINHO, "fornecedores.json"));

  it("tem de 40 a 60 produtos com código de barras válido e ids únicos", () => {
    expect(catalogo.length).toBeGreaterThanOrEqual(40);
    expect(catalogo.length).toBeLessThanOrEqual(60);
    expect(new Set(catalogo.map((c) => c.id)).size).toBe(catalogo.length);
    expect(new Set(catalogo.map((c) => c.codigo_barras)).size).toBe(catalogo.length);
    for (const produto of catalogo) {
      expect(ean13Valido(produto.codigo_barras)).toBe(true);
      expect(Number.isInteger(produto.preco_venda_centavos)).toBe(true);
    }
  });

  it("tem de 5 a 8 fornecedores com CNPJ de dígito verificador válido", () => {
    expect(fornecedores.length).toBeGreaterThanOrEqual(5);
    expect(fornecedores.length).toBeLessThanOrEqual(8);
    for (const fornecedor of fornecedores) expect(cnpjValido(fornecedor.cnpj)).toBe(true);
  });

  it("os arquivos versionados batem com o que o gerador produz", () => {
    const gerado = montarMercadinho();
    expect(catalogo).toEqual(gerado.catalogo);
    expect(fornecedores).toEqual(gerado.fornecedores);
  });
});

describe("vendas determinísticas (#13)", () => {
  const catalogo = montarMercadinho().catalogo;

  it("duas gerações dão o mesmo resultado e batem com o CSV versionado", () => {
    const csv = montarVendasCsv(montarVendas(catalogo), catalogo);
    expect(montarVendasCsv(montarVendas(catalogo), catalogo)).toBe(csv);
    expect(readFileSync(resolve(DIR_MERCADINHO, "vendas.csv"), "utf8")).toBe(csv);
  });

  it("cobre a janela inteira e só vende produtos do catálogo", () => {
    const cupons = montarVendas(catalogo);
    const ids = new Set(catalogo.map((c) => c.id));
    expect(cupons[0]?.data).toBe(INICIO_JANELA);
    expect(cupons[cupons.length - 1]?.data).toBe(DATA_REFERENCIA);
    for (const cupom of cupons) for (const item of cupom.itens) expect(ids.has(item.produtoId)).toBe(true);
  });

  it("planta os padrões: estoque parado, alta de giro e ticket baixo", () => {
    const cupons = montarVendas(catalogo);
    const ultima = (id: string) =>
      cupons.filter((c) => c.itens.some((i) => i.produtoId === id)).at(-1)?.data ?? "";
    expect(diasEntre(ultima("P12"), DATA_REFERENCIA)).toBeGreaterThan(30);
    expect(diasEntre(ultima("P13"), DATA_REFERENCIA)).toBeLessThanOrEqual(30);
    expect(existsSync(resolve(DIR_MERCADINHO, "vendas.xlsx"))).toBe(true);
  });
});

describe("notas de compra e gabarito de extração (#14, #15)", () => {
  const notas = manifesto();

  it("tem de 10 a 20 notas, cada uma com imagem (ou XML) e gabarito", () => {
    expect(notas.length).toBeGreaterThanOrEqual(10);
    expect(notas.length).toBeLessThanOrEqual(20);
    for (const nota of notas) {
      const fonte = nota.arquivo_imagem ?? nota.arquivo_xml;
      expect(fonte).not.toBeNull();
      expect(existsSync(resolve(DIR_NOTAS, fonte ?? ""))).toBe(true);
      expect(existsSync(resolve(DIR_NOTAS, nota.arquivo_esperado))).toBe(true);
    }
  });

  it("tem uma NF-e em XML que repete o gabarito de extração e não dispara reajuste", () => {
    const xmls = notas.filter((n) => n.arquivo_xml);
    expect(xmls).toHaveLength(1);
    const nota = xmls[0]!;
    expect(nota.casos).toContain("nfe_xml");
    expect(nota.reajuste_plantado).toBeNull();
    const xml = readFileSync(resolve(DIR_NOTAS, nota.arquivo_xml ?? ""), "utf8");
    const esperado = extracaoNotaSchema.parse(lerJson(resolve(DIR_NOTAS, nota.arquivo_esperado)));
    expect(xml).toContain(`<CNPJ>${esperado.fornecedor.cnpj}</CNPJ>`);
    expect(xml).toContain(`<vNF>${(esperado.total_centavos / 100).toFixed(2)}</vNF>`);
    expect((xml.match(/<det nItem=/g) ?? []).length).toBe(esperado.itens.length);
    const catalogo = montarMercadinho().catalogo;
    for (const id of nota.vinculos_produto) {
      expect(xml).toContain(`<cEAN>${catalogo.find((p) => p.id === id)?.codigo_barras}</cEAN>`);
    }
  });

  it("todo gabarito passa no esquema Zod da extração", () => {
    for (const nota of notas) {
      const resultado = extracaoNotaSchema.safeParse(lerJson(resolve(DIR_NOTAS, nota.arquivo_esperado)));
      expect({ nota: nota.id, ok: resultado.success }).toEqual({ nota: nota.id, ok: true });
    }
  });

  it("quantidade x valor unitário bate em cada item e o CNPJ é válido", () => {
    for (const nota of notas) {
      const esperado = extracaoNotaSchema.parse(lerJson(resolve(DIR_NOTAS, nota.arquivo_esperado)));
      expect(cnpjValido(esperado.fornecedor.cnpj)).toBe(true);
      for (const item of esperado.itens) {
        expect(item.valor_unitario_centavos * item.quantidade).toBe(item.valor_total_centavos);
      }
      const soma = esperado.itens.reduce((acc, item) => acc + item.valor_total_centavos, 0);
      expect(soma).toBe(nota.soma_itens_centavos);
      expect(soma === esperado.total_centavos).toBe(nota.soma_confere);
    }
  });

  it("marca como confiança baixa exatamente os itens previstos", () => {
    for (const nota of notas) {
      const esperado = extracaoNotaSchema.parse(lerJson(resolve(DIR_NOTAS, nota.arquivo_esperado)));
      const baixos = esperado.itens.flatMap((item, i) => (item.confianca < LIMITE_CONFIANCA_ITEM ? [i] : []));
      expect(baixos).toEqual(nota.itens_confianca_baixa);
    }
  });

  it("cobre os casos difíceis: reajuste, item ilegível, soma errada e injeção", () => {
    const casos = new Set(notas.flatMap((n) => n.casos));
    for (const caso of [
      "reajuste_plantado",
      "item_pouco_legivel",
      "soma_diverge_do_total",
      "texto_de_injecao",
    ]) {
      expect(casos.has(caso)).toBe(true);
    }
    expect(notas.filter((n) => n.reajuste_plantado).map((n) => n.reajuste_plantado?.produto_id)).toEqual([
      "P03",
      "P01",
    ]);
  });

  it("os arquivos versionados batem com o gerador", () => {
    const fornecedores = montarMercadinho().fornecedores;
    for (const nota of montarNotas(fornecedores)) {
      expect(lerJson(resolve(DIR_NOTAS, nota.manifesto.arquivo_esperado))).toEqual(nota.esperado);
    }
    expect(manifesto()).toEqual(montarNotas(fornecedores).map((n) => n.manifesto));
    for (const nota of montarNotas(fornecedores)) {
      if (nota.manifesto.arquivo_xml) {
        expect(readFileSync(resolve(DIR_NOTAS, nota.manifesto.arquivo_xml), "utf8")).toBe(
          montarXmlNfe(nota, montarMercadinho().catalogo),
        );
      }
    }
    expect(NOTAS.length).toBe(notas.length);
    expect(PRODUTOS.length).toBe(montarMercadinho().catalogo.length);
  });
});

describe("gabarito de métricas e alertas (#16)", () => {
  interface Gabarito {
    parametros: { data_referencia: string };
    alertas_esperados: Array<{ tipo: string; produto_id: string | null }>;
    alertas_que_nao_devem_disparar: Array<{ tipo: string }>;
    margem_por_produto: Array<{ produto_id: string; margem_bps: number | null; situacao: string }>;
    variacao_de_custo: Array<{ produto_id: string; variacao_bps: number; dispara_alerta: boolean }>;
  }
  const gabarito = lerJson<Gabarito>(resolve(DIR_GABARITO, "metricas.json"));
  const alertas = (tipo: string) =>
    gabarito.alertas_esperados.filter((a) => a.tipo === tipo).map((a) => a.produto_id);

  it("usa a data de referência fixa", () => {
    expect(gabarito.parametros.data_referencia).toBe(DATA_REFERENCIA);
  });

  it("dispara os alertas plantados e lista os que não podem disparar", () => {
    expect(alertas("reajuste_de_custo").sort()).toEqual(["P01", "P03"]);
    expect(alertas("estoque_parado")).toEqual(["P12"]);
    expect(alertas("ticket_medio_em_queda")).toHaveLength(1);
    expect(alertas("gasto_fora_do_padrao")).toHaveLength(1);
    expect(alertas("margem_abaixo_da_meta").sort()).toEqual(["P01", "P03", "P17", "P23"]);
    expect(gabarito.alertas_que_nao_devem_disparar.length).toBeGreaterThan(0);
  });

  it("arroz subiu 12,05% e produto sem nota fica sem margem", () => {
    expect(gabarito.variacao_de_custo.find((v) => v.produto_id === "P01")?.variacao_bps).toBe(1205);
    const semCusto = gabarito.margem_por_produto.filter((m) => m.situacao === "sem_custo");
    expect(semCusto.length).toBeGreaterThan(0);
    for (const m of semCusto) expect(m.margem_bps).toBeNull();
  });
});

describe("perguntas de avaliação (#17)", () => {
  interface Pergunta {
    id: string;
    tipo: string;
    numeros_esperados: Array<{ valor: number }>;
  }
  const perguntas = lerJson<Pergunta[]>(resolve(DIR_AVALIACAO, "perguntas.json"));

  it("tem 30 ou mais perguntas, 5 sem resposta e 3 de injeção, com ids únicos", () => {
    expect(perguntas.length).toBeGreaterThanOrEqual(30);
    expect(perguntas.filter((p) => p.tipo === "sem_resposta").length).toBeGreaterThanOrEqual(5);
    expect(perguntas.filter((p) => p.tipo === "injecao").length).toBeGreaterThanOrEqual(3);
    expect(new Set(perguntas.map((p) => p.id)).size).toBe(perguntas.length);
  });

  it("toda pergunta numérica traz ao menos um número esperado", () => {
    for (const p of perguntas.filter((x) => x.tipo === "numerica")) {
      expect(p.numeros_esperados.length).toBeGreaterThan(0);
    }
  });

  it("os arquivos versionados batem com o gerador", () => {
    const catalogo = montarMercadinho().catalogo;
    const gabarito = lerJson<Parameters<typeof montarPerguntas>[0]>(resolve(DIR_GABARITO, "metricas.json"));
    expect(perguntas).toEqual(montarPerguntas(gabarito, montarVendas(catalogo), catalogo));
  });
});
