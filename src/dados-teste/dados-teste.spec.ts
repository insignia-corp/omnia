import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cnpjValido } from "../lib/cnpj/cnpj";
import { extracaoNotaSchema } from "../ingestao/extracao-nota.schema";
import { gerarArquivos } from "./gerar";
import { catalogo, fornecedores } from "./mercadinho";
import { definicoesNotas, gabaritoDaNota, itensDeCompra } from "./notas";
import { gerarVendas } from "./vendas";

const LIMITE_CONFIANCA = 0.8;

describe("fixtures do mercadinho", () => {
  const arquivos = gerarArquivos();
  const lerJson = <T>(caminho: string): T => JSON.parse(arquivos.get(caminho)!) as T;

  it("gera arquivos idênticos em duas execuções (determinismo)", () => {
    const segunda = gerarArquivos();
    expect([...segunda.keys()]).toEqual([...arquivos.keys()]);
    for (const [caminho, conteudo] of arquivos) expect(segunda.get(caminho)).toBe(conteudo);
  });

  it("os arquivos versionados em fixtures/ são os que o gerador produz hoje", () => {
    for (const [caminho, conteudo] of arquivos) {
      const real = join(process.cwd(), "fixtures", caminho);
      expect(existsSync(real)).toBe(true);
      // Se falhar, rode `npm run fixtures:gerar` e revise o diff.
      expect(readFileSync(real, "utf8")).toBe(conteudo);
    }
  });

  describe("catálogo e fornecedores", () => {
    it("tem 40 a 60 produtos com EAN-13 válido e SKU único", () => {
      expect(catalogo.length).toBeGreaterThanOrEqual(40);
      expect(catalogo.length).toBeLessThanOrEqual(60);
      expect(new Set(catalogo.map((p) => p.sku)).size).toBe(catalogo.length);
      expect(new Set(catalogo.map((p) => p.codigo_barras)).size).toBe(catalogo.length);
      for (const p of catalogo) {
        expect(p.codigo_barras).toMatch(/^\d{13}$/);
        const soma = [...p.codigo_barras.slice(0, 12)].reduce(
          (a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3),
          0,
        );
        expect(Number(p.codigo_barras[12])).toBe((10 - (soma % 10)) % 10);
        expect(Number.isInteger(p.preco_venda_centavos)).toBe(true);
      }
    });

    it("tem 5 a 8 fornecedores com CNPJ de dígito verificador válido", () => {
      expect(fornecedores.length).toBeGreaterThanOrEqual(5);
      expect(fornecedores.length).toBeLessThanOrEqual(8);
      for (const f of fornecedores) expect(cnpjValido(f.cnpj)).toBe(true);
    });
  });

  describe("vendas", () => {
    const vendas = gerarVendas();

    it("cobre 35 dias com dinheiro inteiro e quantidades positivas", () => {
      expect(new Set(vendas.map((v) => v.data)).size).toBe(35);
      for (const v of vendas) {
        expect(Number.isInteger(v.preco_unitario_centavos)).toBe(true);
        expect(v.quantidade).toBeGreaterThan(0);
      }
    });

    it("todo produto comprado vendeu ao menos uma vez (estoque parado só pelo padrão plantado)", () => {
      const vendidos = new Set(vendas.map((v) => v.sku));
      for (const c of itensDeCompra()) expect(vendidos.has(c.sku)).toBe(true);
    });

    it("exporta CSV com cabeçalho, separador ponto e vírgula e vírgula decimal", () => {
      const [cabecalho, primeira] = arquivos.get("vendas/vendas.csv")!.split("\n");
      expect(cabecalho).toBe("data;hora;cupom;codigo_barras;produto;quantidade;preco_unitario;total");
      expect(primeira).toMatch(
        /^\d{2}\/\d{2}\/\d{4};\d{2}:\d{2};V\d{5};789\d{10};.+;\d+;\d+,\d{2};\d+,\d{2}$/,
      );
    });
  });

  describe("notas de compra", () => {
    it("tem 10 a 20 notas e os casos difíceis exigidos", () => {
      expect(definicoesNotas.length).toBeGreaterThanOrEqual(10);
      expect(definicoesNotas.length).toBeLessThanOrEqual(20);
      const gabaritos = definicoesNotas.map(gabaritoDaNota);
      expect(gabaritos.some((g) => g.esperado.itens_confianca_baixa.length > 0)).toBe(true);
      expect(gabaritos.some((g) => g.esperado.total_diverge)).toBe(true);
      expect(gabaritos.some((g) => g.esperado.contem_injecao)).toBe(true);
      expect(gabaritos.some((g) => g.esperado.formato === "xml")).toBe(true);
    });

    it.each(definicoesNotas.map((n) => [n.id, n] as const))(
      "%s: gabarito passa no esquema e na aritmética",
      (_id, n) => {
        const { extracao, esperado } = lerJson<ReturnType<typeof gabaritoDaNota>>(
          `notas/${n.id}.esperado.json`,
        );
        expect(extracaoNotaSchema.safeParse(extracao).success).toBe(true);
        expect(cnpjValido(extracao.fornecedor.cnpj)).toBe(true);
        for (const item of extracao.itens) {
          expect(item.quantidade * item.valor_unitario_centavos).toBe(item.valor_total_centavos);
        }
        const soma = extracao.itens.reduce((a, i) => a + i.valor_total_centavos, 0);
        expect(soma).toBe(esperado.soma_itens_centavos);
        expect(soma === extracao.total_centavos).toBe(!esperado.total_diverge);
        extracao.itens.forEach((item, i) => {
          expect(item.confianca < LIMITE_CONFIANCA).toBe(esperado.itens_confianca_baixa.includes(i));
        });
        expect(esperado.skus).toHaveLength(extracao.itens.length);
        // A imagem renderizada comporta até 28 caracteres de descrição por linha.
        for (const item of extracao.itens) expect(item.descricao.length).toBeLessThanOrEqual(28);
      },
    );

    it("não tem duas notas do mesmo fornecedor no mesmo dia com o mesmo produto", () => {
      const chaves = itensDeCompra().map((c) => `${c.data}:${c.fornecedor_id}:${c.sku}`);
      expect(new Set(chaves).size).toBe(chaves.length);
    });
  });

  describe("gabarito de métricas e alertas", () => {
    const g = lerJson<{
      alertas_esperados: { tipo: string; chave: string }[];
      alertas_que_nao_devem_disparar: { tipo: string; chave: string }[];
      variacao_de_custo: { sku: string; variacao_bps: number; acima_do_limite: boolean }[];
    }>("gabarito/metricas.json");

    it("dispara exatamente os alertas plantados", () => {
      expect(g.alertas_esperados.map((a) => `${a.tipo}:${a.chave}`)).toEqual([
        "variacao_custo:P001:F1",
        "espaco_para_subir_preco:P001",
        "estoque_parado:P018",
        "ticket_medio:2026-10-19",
        "gasto_fora_do_padrao:2026-10-19",
      ]);
    });

    it("lista casos sem alarme, incluindo reajuste abaixo do limite e troca de fornecedor", () => {
      const nao = g.alertas_que_nao_devem_disparar.map((a) => `${a.tipo}:${a.chave}`);
      expect(nao).toContain("variacao_custo:ovos-troca-de-fornecedor");
      expect(nao.some((c) => c.startsWith("variacao_custo:P007"))).toBe(true);
      for (const a of g.alertas_esperados) expect(nao).not.toContain(`${a.tipo}:${a.chave}`);
    });

    it("só um reajuste passa de 5%, o plantado na cola", () => {
      const acima = g.variacao_de_custo.filter((v) => v.acima_do_limite);
      expect(acima).toHaveLength(1);
      expect(acima[0]!.variacao_bps).toBeGreaterThan(500);
    });
  });

  describe("perguntas de avaliação", () => {
    const perguntas =
      lerJson<{ id: string; tipo: string; pergunta: string; numeros_esperados: { valor: number }[] }[]>(
        "avaliacao/perguntas.json",
      );

    it("tem 30 ou mais perguntas, 5 sem resposta e 3 de injeção", () => {
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
  });

  describe("extrato bancário", () => {
    const transacoes =
      lerJson<{ data: string; valor_centavos: number; tipo: string; categoria: string }[]>(
        "banco/transacoes.json",
      );

    it("cobre 60 dias com valores inteiros positivos", () => {
      expect(new Set(transacoes.map((t) => t.data)).size).toBe(60);
      for (const t of transacoes) {
        expect(Number.isInteger(t.valor_centavos)).toBe(true);
        expect(t.valor_centavos).toBeGreaterThan(0);
        expect(["entrada", "saida"]).toContain(t.tipo);
      }
    });

    it("as entradas dos dias com vendas fecham com o faturamento do dia", () => {
      const vendas = gerarVendas();
      const porDia = new Map<string, number>();
      for (const v of vendas)
        porDia.set(v.data, (porDia.get(v.data) ?? 0) + v.quantidade * v.preco_unitario_centavos);
      for (const [data, faturamento] of porDia) {
        const entradas = transacoes
          .filter((t) => t.tipo === "entrada" && t.data === data)
          .reduce((a, t) => a + t.valor_centavos, 0);
        expect(entradas).toBe(faturamento);
      }
    });

    it("tem o gasto anômalo plantado na data de referência", () => {
      expect(
        transacoes.some(
          (t) => t.data === "2026-10-19" && t.categoria === "manutencao" && t.valor_centavos === 235_000,
        ),
      ).toBe(true);
    });
  });
});
