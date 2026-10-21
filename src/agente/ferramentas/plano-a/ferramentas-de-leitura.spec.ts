import { randomUUID } from "node:crypto";
import type { Db } from "../../../infra/database/database.module";
import type { MetricasService } from "../../../metricas/metricas.service";
import { dadoAusente, ehDadoAusente, type ResultadoMetrica } from "../../../metricas/resultado-metrica";
import { NumerosAutorizados, verificarNumeros } from "../../../lib/verificador-numeros/verificador-numeros";
import type { ContextoSessao, Ferramenta } from "../ferramenta";
import { RegistroFerramentas } from "../registro-ferramentas";
import { criarGetCostChanges } from "./get-cost-changes";
import { criarGetDailySummary } from "./get-daily-summary";
import { LIMITE_SIMILARIDADE_PADRAO } from "../../../config/env";
import { criarGetProductMargin } from "./get-product-margin";
import { SIMILARIDADE_PARA_ESCOLHER_PRODUTO } from "./buscar-produto";
import { criarGetTopProducts } from "./get-top-products";

const contexto: ContextoSessao = {
  comercianteId: randomUUID(),
  nomeComercio: "Mercadinho Teste",
  dataReferencia: "2026-10-19",
};
const periodo = { inicio: "2026-10-13", fim: "2026-10-19" };
const metrica = <T>(valor: T): ResultadoMetrica<T> => ({
  valor,
  periodo,
  n_registros: 12,
  menor_confianca: 0.92,
  origens: ["planilha"],
});

const giroDoProduto = (nome: string, unidades: number, alta: number | null) => ({
  produto_id: randomUUID(),
  nome,
  unidades_7_dias: unidades,
  unidades_28_dias_anteriores: 80,
  media_semanal_28_dias: 20,
  alta_bps: alta,
  alta_percentual: alta === null ? null : alta / 100,
  elegivel_para_alta: alta !== null,
});
const variacao = (acima: boolean, recente: boolean) => ({
  produto_id: randomUUID(),
  nome: "Arroz Tipo 1 5kg",
  fornecedor_id: randomUUID(),
  custo_anterior_centavos: 2000,
  custo_atual_centavos: acima ? 2400 : 2040,
  compra_anterior_data: "2026-09-01",
  compra_atual_data: "2026-10-15",
  variacao_bps: acima ? 2000 : 200,
  variacao_percentual: acima ? 20 : 2,
  acima_do_limite: acima,
  recente,
  menor_confianca: 0.9,
});
const margem = (produtoId: string) => ({
  produto_id: produtoId,
  nome: "Refrigerante 2L",
  preco_medio_venda_centavos: 899,
  unidades_vendidas: 140,
  custo_compra_mais_recente_centavos: 650,
  compra_data: "2026-10-10",
  fornecedor_id: randomUUID(),
  margem_bps: 2770,
  margem_percentual: 27.7,
  meta_bps: 3000,
  meta_percentual: 30,
  abaixo_da_meta: true,
});

const dbCom = (linhas: Array<{ produto_id: string; nome: string; sim: number }>) =>
  ({ execute: jest.fn(async () => ({ rows: linhas })) }) as unknown as Db & { execute: jest.Mock };

/** db falso para a consulta de nomes de fornecedor: select().from().where() devolve as linhas dadas. */
const dbDeFornecedores = (linhas: Array<{ id: string; nome: string }> = []) =>
  ({
    select: () => ({ from: () => ({ where: async () => linhas }) }),
  }) as unknown as Db;

const esperadoDoGiro = [giroDoProduto("Cerveja Lata", 120, 3000), giroDoProduto("Água 500ml", 90, 1500)];
const servico = () => {
  const mock = {
    resumoDiario: jest.fn(async () =>
      metrica({ data: "2026-10-19", faturamento_centavos: 122151, cupons: 80 }),
    ),
    giro: jest.fn(async () =>
      metrica({
        periodos: { ultimos_7_dias: periodo, anteriores_28_dias: periodo },
        por_produto: esperadoDoGiro,
        maior_alta: [esperadoDoGiro[0]],
        maior_volume: esperadoDoGiro,
        giro_alto: [],
      }),
    ),
    variacoesDeCusto: jest.fn(async () => metrica([variacao(true, true), variacao(false, false)])),
    margemDoProduto: jest.fn(async (_c: unknown, id: string) => metrica(margem(id))),
  };
  return { mock, metricas: mock as unknown as MetricasService };
};

describe("ferramentas de leitura do plano A", () => {
  const { metricas } = servico();
  const db = dbCom([]);
  const todas: Array<{ ferramenta: Ferramenta; entrada: Record<string, unknown> }> = [
    { ferramenta: criarGetDailySummary(metricas), entrada: {} },
    { ferramenta: criarGetTopProducts(metricas), entrada: {} },
    { ferramenta: criarGetProductMargin(metricas, db), entrada: { produto: "Refrigerante" } },
    { ferramenta: criarGetCostChanges(metricas, dbDeFornecedores()), entrada: {} },
  ];

  it("têm os nomes do catálogo, efeito nenhum e entram no registro (sem comerciante_id no esquema)", () => {
    expect(todas.map((t) => t.ferramenta.nome)).toEqual([
      "get_daily_summary",
      "get_top_products",
      "get_product_margin",
      "get_cost_changes",
    ]);
    expect(todas.every((t) => t.ferramenta.efeito === "nenhum")).toBe(true);
    expect(() => new RegistroFerramentas(todas.map((t) => t.ferramenta))).not.toThrow();
  });

  describe.each(todas)("$ferramenta.nome", ({ ferramenta, entrada }) => {
    it("regra 3: recusa comerciante_id vindo do modelo", async () => {
      expect(ferramenta.entrada.safeParse(entrada).success).toBe(true);
      expect(ferramenta.entrada.safeParse({ ...entrada, comerciante_id: randomUUID() }).success).toBe(false);
      expect(ferramenta.entrada.safeParse({ ...entrada, comercianteId: randomUUID() }).success).toBe(false);

      const registro = new RegistroFerramentas([ferramenta]);
      const r = await registro.executar(contexto, ferramenta.nome, {
        ...entrada,
        comerciante_id: randomUUID(),
      });
      expect(r.ok).toBe(false);
    });
  });

  it("regra 3: o comerciante que chega às métricas é o da sessão", async () => {
    const { mock, metricas: m } = servico();
    const banco = dbCom([{ produto_id: randomUUID(), nome: "Refrigerante 2L", sim: 0.9 }]);
    const registro = new RegistroFerramentas([
      criarGetDailySummary(m),
      criarGetTopProducts(m),
      criarGetProductMargin(m, banco),
      criarGetCostChanges(m, dbDeFornecedores()),
    ]);
    for (const [nome, entrada] of [
      ["get_daily_summary", {}],
      ["get_top_products", {}],
      ["get_product_margin", { produto: "Refrigerante" }],
      ["get_cost_changes", {}],
    ] as const) {
      expect((await registro.executar(contexto, nome, entrada)).ok).toBe(true);
    }
    for (const chamadas of [
      mock.resumoDiario.mock.calls,
      mock.giro.mock.calls,
      mock.variacoesDeCusto.mock.calls,
      mock.margemDoProduto.mock.calls,
    ]) {
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0]?.[0]).toBe(contexto);
    }
    // A busca por nome também é do comerciante da sessão (o SQL leva o id da sessão como parâmetro).
    const consulta = banco.execute.mock.calls[0]?.[0] as { queryChunks: unknown[] };
    expect(consulta.queryChunks).toContain(contexto.comercianteId);
  });

  describe("regra 8: os números da saída autorizam a mensagem", () => {
    const autorizar = (saida: unknown) => new NumerosAutorizados([saida]);

    it("get_daily_summary: faturamento em reais e cupons", async () => {
      const saida = await criarGetDailySummary(servico().metricas).executar(contexto, {});
      const aut = autorizar(saida);
      expect(verificarNumeros("Ontem você vendeu R$ 1.221,51 em 80 cupons.", aut).aprovado).toBe(true);
      expect(verificarNumeros("Ontem você vendeu R$ 1.300,00.", aut).aprovado).toBe(false);
    });

    it("get_top_products: unidades e alta", async () => {
      const saida = await criarGetTopProducts(servico().metricas).executar(contexto, { criterio: "volume" });
      const aut = autorizar(saida);
      expect(verificarNumeros("Cerveja Lata vendeu 120 unidades e Água 500ml, 90.", aut).aprovado).toBe(true);
      expect(verificarNumeros("Cerveja Lata vendeu 121 unidades.", aut).aprovado).toBe(false);
    });

    it("get_product_margin: preço, custo e margem", async () => {
      const banco = dbCom([{ produto_id: randomUUID(), nome: "Refrigerante 2L", sim: 0.9 }]);
      const saida = await criarGetProductMargin(servico().metricas, banco).executar(contexto, {
        produto: "Refrigerante",
      });
      const aut = autorizar(saida);
      expect(verificarNumeros("Vende a R$ 8,99, custa R$ 6,50 e a margem é de 27,7%.", aut).aprovado).toBe(
        true,
      );
      expect(verificarNumeros("A margem é de 35%.", aut).aprovado).toBe(false);
    });

    it("get_cost_changes: custos e variação", async () => {
      const saida = await criarGetCostChanges(servico().metricas, dbDeFornecedores()).executar(contexto, {
        filtro: "todos",
      });
      const aut = autorizar(saida);
      expect(verificarNumeros("Subiu 20%, de R$ 20,00 para R$ 24,00.", aut).aprovado).toBe(true);
      expect(verificarNumeros("Subiu 25%.", aut).aprovado).toBe(false);
    });
  });

  describe("get_daily_summary", () => {
    it("repassa gastos e saldo ausentes sem trocar por zero", async () => {
      const ausente = dadoAusente("sem_extrato_no_dia", "Sem extrato para o dia.");
      const m = {
        resumoDiario: jest.fn(async () =>
          metrica({ faturamento_centavos: 5000, gastos_centavos: ausente, saldo_do_dia_centavos: ausente }),
        ),
      } as unknown as MetricasService;
      const saida = (await criarGetDailySummary(m).executar(contexto, {})) as ResultadoMetrica<{
        gastos_centavos: unknown;
        saldo_do_dia_centavos: unknown;
      }>;
      expect(saida.valor.gastos_centavos).toBe(ausente);
      expect(saida.valor.saldo_do_dia_centavos).toBe(ausente);
    });

    it("repassa o resumo ausente e a data pedida", async () => {
      const ausente = dadoAusente("sem_vendas", "Sem vendas.");
      const resumoDiario = jest.fn(async () => ausente);
      const saida = await criarGetDailySummary({ resumoDiario } as unknown as MetricasService).executar(
        contexto,
        { data: "2026-10-18" },
      );
      expect(saida).toBe(ausente);
      expect(resumoDiario).toHaveBeenCalledWith(contexto, "2026-10-18");
    });

    it("rejeita data inválida e campo desconhecido", () => {
      const f = criarGetDailySummary(servico().metricas);
      expect(f.entrada.safeParse({ data: "ontem" }).success).toBe(false);
      expect(f.entrada.safeParse({ data: "2026-13-40" }).success).toBe(false);
      expect(f.entrada.safeParse({ dias: 7 }).success).toBe(false);
    });
  });

  describe("get_top_products", () => {
    it("alta devolve o ranking de maior alta e volume é o padrão", async () => {
      const f = criarGetTopProducts(servico().metricas);
      const alta = (await f.executar(contexto, { criterio: "alta" })) as ResultadoMetrica<{
        criterio: string;
        produtos: unknown[];
      }>;
      expect(alta.valor.criterio).toBe("alta");
      expect(alta.valor.produtos).toHaveLength(1);
      expect(alta.n_registros).toBe(12);
      expect(alta.menor_confianca).toBe(0.92);
      expect(f.entrada.parse({}).criterio).toBe("volume");
      expect(f.entrada.safeParse({ criterio: "receita" }).success).toBe(false);
    });

    it("repassa o giro ausente", async () => {
      const ausente = dadoAusente("sem_cobertura_de_vendas", "Sem vendas nas duas janelas.");
      const f = criarGetTopProducts({ giro: jest.fn(async () => ausente) } as unknown as MetricasService);
      expect(await f.executar(contexto, { criterio: "volume" })).toBe(ausente);
    });
  });

  describe("get_cost_changes", () => {
    it("lista vazia da métrica vira dado ausente, não 'sem variação'", async () => {
      const m = { variacoesDeCusto: jest.fn(async () => metrica([])) } as unknown as MetricasService;
      for (const filtro of ["todos", "acima_do_limite", "recentes"] as const) {
        const saida = await criarGetCostChanges(m, dbDeFornecedores()).executar(contexto, { filtro });
        expect(saida).toMatchObject({ ausente: true, codigo: "sem_variacao_calculavel" });
        expect((saida as { motivo: string }).motivo).toMatch(/não prova/);
      }
    });

    it("filtro que não deixa nada, com variações existentes, devolve lista vazia", async () => {
      const m = {
        variacoesDeCusto: jest.fn(async () => metrica([variacao(false, false)])),
      } as unknown as MetricasService;
      const saida = await criarGetCostChanges(m, dbDeFornecedores()).executar(contexto, {
        filtro: "acima_do_limite",
      });
      expect(saida).toMatchObject({ valor: [] });
    });

    it("junta o nome do fornecedor do cadastro, e fica nulo sem cadastro", async () => {
      const comNome = variacao(true, true);
      const semNome = variacao(false, false);
      const m = {
        variacoesDeCusto: jest.fn(async () => metrica([comNome, semNome])),
      } as unknown as MetricasService;
      const saida = await criarGetCostChanges(
        m,
        dbDeFornecedores([{ id: comNome.fornecedor_id, nome: "Atacadão Teste" }]),
      ).executar(contexto, { filtro: "todos" });
      if (ehDadoAusente(saida)) throw new Error("dado ausente inesperado");
      expect(saida.valor.map((v) => v.fornecedor_nome)).toEqual(["Atacadão Teste", null]);
    });

    it("filtra pelas marcas da métrica e mantém a procedência", async () => {
      const f = criarGetCostChanges(servico().metricas, dbDeFornecedores());
      const comoMetrica = async (filtro: "todos" | "acima_do_limite" | "recentes") => {
        const saida = await f.executar(contexto, { filtro });
        if (ehDadoAusente(saida)) throw new Error("dado ausente inesperado");
        return saida;
      };
      const todos = (await comoMetrica("todos")).valor;
      const acima = await comoMetrica("acima_do_limite");
      const recentes = await comoMetrica("recentes");
      expect(todos).toHaveLength(2);
      expect(acima.valor).toHaveLength(1);
      expect(acima.valor.every((v) => v.acima_do_limite)).toBe(true);
      expect(recentes.valor.every((v) => v.recente)).toBe(true);
      expect(acima.menor_confianca).toBe(0.92);
    });
  });

  describe("get_product_margin", () => {
    it("rejeita nome vazio ou curto demais", () => {
      const f = criarGetProductMargin(servico().metricas, dbCom([]));
      expect(f.entrada.safeParse({ produto: "" }).success).toBe(false);
      expect(f.entrada.safeParse({ produto: " a " }).success).toBe(false);
      expect(f.entrada.safeParse({ produto_id: randomUUID() }).success).toBe(false);
    });

    it("sem produto parecido devolve dado ausente, sem chamar a métrica", async () => {
      const { mock, metricas: m } = servico();
      const saida = await criarGetProductMargin(m, dbCom([])).executar(contexto, { produto: "Xyz" });
      expect(saida).toMatchObject({ ausente: true, codigo: "produto_nao_encontrado" });
      expect(mock.margemDoProduto).not.toHaveBeenCalled();
    });

    it("nome ambíguo devolve candidatos para perguntar ao dono", async () => {
      const { mock, metricas: m } = servico();
      const banco = dbCom([
        { produto_id: randomUUID(), nome: "Refrigerante Cola 2L", sim: 0.55 },
        { produto_id: randomUUID(), nome: "Refrigerante Guaraná 2L", sim: 0.52 },
      ]);
      const saida = await criarGetProductMargin(m, banco).executar(contexto, { produto: "Refrigerante 2L" });
      expect(saida).toMatchObject({ ambiguo: true });
      expect((saida as { candidatos: unknown[] }).candidatos).toHaveLength(2);
      expect(mock.margemDoProduto).not.toHaveBeenCalled();
    });

    it("usa o mesmo limite de similaridade do vínculo de notas: 0,42 não liga sozinho, 0,46 liga", async () => {
      expect(SIMILARIDADE_PARA_ESCOLHER_PRODUTO).toBe(LIMITE_SIMILARIDADE_PADRAO);
      const fraco = servico();
      const saidaFraca = await criarGetProductMargin(
        fraco.metricas,
        dbCom([{ produto_id: randomUUID(), nome: "Refrigerante 2L", sim: 0.42 }]),
      ).executar(contexto, { produto: "Refri" });
      expect(saidaFraca).toMatchObject({ ambiguo: true });
      expect(fraco.mock.margemDoProduto).not.toHaveBeenCalled();

      const forte = servico();
      await criarGetProductMargin(
        forte.metricas,
        dbCom([{ produto_id: randomUUID(), nome: "Refrigerante 2L", sim: 0.46 }]),
      ).executar(contexto, { produto: "Refri" });
      expect(forte.mock.margemDoProduto).toHaveBeenCalledTimes(1);
    });

    it("produto claro vai para a métrica com o id achado", async () => {
      const { mock, metricas: m } = servico();
      const id = randomUUID();
      const banco = dbCom([
        { produto_id: id, nome: "Refrigerante 2L", sim: 0.9 },
        { produto_id: randomUUID(), nome: "Suco", sim: 0.1 },
      ]);
      await criarGetProductMargin(m, banco).executar(contexto, { produto: "Refrigerante 2L" });
      expect(mock.margemDoProduto).toHaveBeenCalledWith(contexto, id);
    });

    it("um achado fraco rebaixa a confiança do resultado e um achado forte não a muda", async () => {
      const fraco = await criarGetProductMargin(
        servico().metricas,
        dbCom([{ produto_id: randomUUID(), nome: "Refrigerante 2L", sim: 0.5 }]),
      ).executar(contexto, { produto: "Refri" });
      expect(fraco).toMatchObject({ confianca_da_busca: 0.5, menor_confianca: 0.5 });

      const forte = await criarGetProductMargin(
        servico().metricas,
        dbCom([{ produto_id: randomUUID(), nome: "Refrigerante 2L", sim: 0.95 }]),
      ).executar(contexto, { produto: "Refrigerante 2L" });
      expect(forte).toMatchObject({ confianca_da_busca: 0.95, menor_confianca: 0.92 });
    });

    it("produto achado sem custo devolve o ausente da métrica com o produto_id e o nome achados", async () => {
      const ausente = dadoAusente("sem_custo", "Sem nota para o produto.", "Qual o custo?");
      const m = { margemDoProduto: jest.fn(async () => ausente) } as unknown as MetricasService;
      const id = randomUUID();
      const banco = dbCom([{ produto_id: id, nome: "Refrigerante 2L", sim: 0.9 }]);
      const saida = await criarGetProductMargin(m, banco).executar(contexto, { produto: "Refrigerante" });
      expect(saida).toEqual({ ...ausente, produto_id: id, nome: "Refrigerante 2L" });
    });
  });

  it("descrições sem travessão", () => {
    for (const { ferramenta } of todas) expect(ferramenta.descricao).not.toMatch(/[—–]/);
  });
});
