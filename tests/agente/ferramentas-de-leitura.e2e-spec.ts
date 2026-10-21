import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { montarCatalogo } from "../../src/agente/ferramentas/catalogo";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import { RegistroFerramentas } from "../../src/agente/ferramentas/registro-ferramentas";
import { criarGetCostChanges } from "../../src/agente/ferramentas/plano-a/get-cost-changes";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import type { MetricasService } from "../../src/metricas/metricas.service";
import { NumerosAutorizados, verificarNumeros } from "../../src/lib/verificador-numeros/verificador-numeros";

/**
 * As ferramentas de leitura do plano A (issues #50 e #51) pelo registro, como o agente as chama,
 * contra o seed e o gabarito das métricas (fixtures/gabarito/metricas.json).
 */

interface Gabarito {
  parametros: { data_referencia: string };
  fornecedores: Array<{ id: string; nome: string }>;
  resumo_diario: {
    referencia: {
      faturamento_centavos: number;
      gastos_centavos: number;
      saldo_do_dia_centavos: number;
      cupons: number;
    };
  };
  margem_por_produto: Array<{
    produto_id: string;
    nome: string;
    situacao: string;
    margem_bps: number | null;
    preco_medio_venda_centavos: number | null;
    custo_compra_mais_recente_centavos: number | null;
  }>;
  variacao_de_custo: Array<{
    produto_id: string;
    fornecedor_id: string;
    custo_anterior_centavos: number;
    custo_atual_centavos: number;
    variacao_bps: number;
    acima_do_limite: boolean;
  }>;
  giro: {
    maior_alta: Array<{ produto_id: string; alta_bps: number | null }>;
    maior_volume: Array<{ produto_id: string; unidades_7_dias: number }>;
  };
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;
const REF = gabarito.parametros.data_referencia;

/** O que o teste lê da saída: valor da métrica, dado ausente ou lista de candidatos. */
interface Saida {
  valor: Record<string, unknown>;
  menor_confianca?: number | null;
  ausente?: true;
  ambiguo?: true;
  codigo?: string;
  candidatos?: Array<{ produto_id: string; nome: string; codigo_barras: string | null }>;
  motivo?: string;
  confianca_da_busca?: number;
}

describe("ferramentas de leitura do plano A (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const registro = new RegistroFerramentas(montarCatalogo({ db }));

  let vilaNova: ContextoSessao;
  let esquina: ContextoSessao;
  const skuPorProduto = new Map<string, string>();

  const chamar = async (contexto: ContextoSessao, nome: string, entrada: unknown) => {
    const r = await registro.executar(contexto, nome, entrada);
    if (!r.ok) throw new Error(r.erro);
    return r.saida as Saida;
  };

  beforeAll(async () => {
    await migrar(url);
    const resumo = await semear(db);
    const contextoDe = (nome: string): ContextoSessao => {
      const linha = resumo.find((r) => r.comerciante === nome);
      if (!linha) throw new Error(`Comerciante ${nome} não está no seed`);
      return { comercianteId: linha.comercianteId, nomeComercio: nome, dataReferencia: REF };
    };
    vilaNova = contextoDe("Mercadinho Vila Nova");
    esquina = contextoDe("Conveniência Esquina 24h");
    const produtos = await db
      .select({ id: schema.produto.id, sku: schema.produto.sku })
      .from(schema.produto)
      .where(eq(schema.produto.comercianteId, vilaNova.comercianteId));
    for (const p of produtos) if (p.sku) skuPorProduto.set(p.id, p.sku);
  });

  afterAll(() => pool.end());

  it("o catálogo registra as quatro ferramentas de leitura", () => {
    expect(registro.nomes).toEqual(
      expect.arrayContaining([
        "get_daily_summary",
        "get_top_products",
        "get_product_margin",
        "get_cost_changes",
      ]),
    );
  });

  it("get_daily_summary devolve os números do gabarito, e o verificador os aceita", async () => {
    const saida = await chamar(vilaNova, "get_daily_summary", {});
    const esperado = gabarito.resumo_diario.referencia;
    expect(saida.valor).toMatchObject({
      data: REF,
      faturamento_centavos: esperado.faturamento_centavos,
      gastos_centavos: esperado.gastos_centavos,
      saldo_do_dia_centavos: esperado.saldo_do_dia_centavos,
      cupons: esperado.cupons,
    });
    const mensagem = "Você faturou R$ 1.221,51 em 78 cupons e gastou R$ 1.015,34.";
    expect(verificarNumeros(mensagem, new NumerosAutorizados([saida])).aprovado).toBe(true);
    expect(verificarNumeros("Você faturou R$ 1.300,00.", new NumerosAutorizados([saida])).aprovado).toBe(
      false,
    );
  });

  it("get_daily_summary de um dia sem dados devolve dado ausente, não zero", async () => {
    const saida = await chamar(vilaNova, "get_daily_summary", { data: "2020-01-01" });
    expect(saida.ausente).toBe(true);
  });

  it("get_top_products devolve os rankings do gabarito", async () => {
    const volume = await chamar(vilaNova, "get_top_products", { criterio: "volume" });
    const produtosVolume = volume.valor.produtos as Array<{ produto_id: string; unidades_7_dias: number }>;
    expect(produtosVolume.map((p) => [skuPorProduto.get(p.produto_id), p.unidades_7_dias])).toEqual(
      gabarito.giro.maior_volume.map((p) => [p.produto_id, p.unidades_7_dias]),
    );
    const alta = await chamar(vilaNova, "get_top_products", { criterio: "alta" });
    const produtosAlta = alta.valor.produtos as Array<{ produto_id: string; alta_bps: number | null }>;
    expect(produtosAlta.map((p) => [skuPorProduto.get(p.produto_id), p.alta_bps])).toEqual(
      gabarito.giro.maior_alta.map((p) => [p.produto_id, p.alta_bps]),
    );
  });

  it("get_product_margin acha o produto pelo nome aproximado e bate com o gabarito", async () => {
    const esperado = gabarito.margem_por_produto.find((m) => m.nome === "Refrigerante cola 2L");
    expect(esperado?.situacao).toBe("ok");
    for (const nome of ["Refrigerante cola 2L", "refrigerante cola 2 l"]) {
      const saida = await chamar(vilaNova, "get_product_margin", { produto: nome });
      expect(saida.valor).toMatchObject({
        nome: "Refrigerante cola 2L",
        margem_bps: esperado?.margem_bps,
        preco_medio_venda_centavos: esperado?.preco_medio_venda_centavos,
        custo_compra_mais_recente_centavos: esperado?.custo_compra_mais_recente_centavos,
      });
      expect(saida.menor_confianca).toEqual(expect.any(Number));
    }
  });

  it("get_product_margin: nome sem parecido é dado ausente e nome vago traz candidatos", async () => {
    const nada = await chamar(vilaNova, "get_product_margin", { produto: "Zzzzzz Qqqqq" });
    expect(nada).toMatchObject({ ausente: true, codigo: "produto_nao_encontrado" });
    const vago = await chamar(vilaNova, "get_product_margin", { produto: "Refrigerante" });
    expect(vago.ambiguo).toBe(true);
    expect((vago.candidatos ?? []).map((c) => c.nome)).toEqual(
      expect.arrayContaining(["Refrigerante cola 2L", "Refrigerante guaraná 2L"]),
    );
  });

  describe("nome curto contra o catálogo real do seed", () => {
    /** Nome do produto achado: da margem, ou do dado ausente que o devolve com o id. */
    const achado = (saida: Saida & { nome?: string }) =>
      (saida.valor as { nome?: string } | undefined)?.nome ?? saida.nome;

    it.each([
      ["arroz", "Arroz branco tipo 1 5kg"],
      ["Arroz 5kg", "Arroz branco tipo 1 5kg"],
      ["feijão", "Feijão carioca tipo 1 1kg"],
      ["café", "Café torrado e moído 500g"],
      ["açúcar", "Açúcar refinado 1kg"],
      ["detergente", "Detergente líquido 500ml"],
    ])("%s liga sozinho a %s", async (digitado, esperado) => {
      const saida = await chamar(vilaNova, "get_product_margin", { produto: digitado });
      expect(saida.ambiguo).toBeUndefined();
      expect(achado(saida)).toBe(esperado);
      expect(saida.confianca_da_busca).toBeGreaterThanOrEqual(0.45);
    });

    it("nome genérico com vários produtos continua sendo sugestão, não liga sozinho", async () => {
      const saida = await chamar(vilaNova, "get_product_margin", { produto: "refrigerante" });
      expect(saida.ambiguo).toBe(true);
      const nomes = (saida.candidatos ?? []).map((c) => c.nome);
      expect(nomes.length).toBeGreaterThan(1);
      expect(nomes).toEqual(expect.arrayContaining(["Refrigerante cola 2L", "Refrigerante guaraná 2L"]));
      expect(saida.motivo).toMatch(/Mais de um/);
    });

    it("pergunta inteira no lugar do nome: um só candidato, dito com honestidade", async () => {
      const saida = await chamar(vilaNova, "get_product_margin", { produto: "margem do arroz" });
      expect(saida.ambiguo).toBe(true);
      expect(saida.candidatos).toEqual([expect.objectContaining({ nome: "Arroz branco tipo 1 5kg" })]);
      expect(saida.motivo).not.toMatch(/Mais de um/);
      expect(saida.motivo).toMatch(/certeza/);
    });
  });

  it("get_cost_changes devolve as variações do gabarito", async () => {
    const saida = await chamar(vilaNova, "get_cost_changes", {});
    const valor = saida.valor as unknown as Array<{
      produto_id: string;
      custo_anterior_centavos: number;
      custo_atual_centavos: number;
      variacao_bps: number;
      acima_do_limite: boolean;
    }>;
    expect(
      valor.map((v) => [
        skuPorProduto.get(v.produto_id),
        v.custo_anterior_centavos,
        v.custo_atual_centavos,
        v.variacao_bps,
        v.acima_do_limite,
      ]),
    ).toEqual(
      gabarito.variacao_de_custo.map((v) => [
        v.produto_id,
        v.custo_anterior_centavos,
        v.custo_atual_centavos,
        v.variacao_bps,
        v.acima_do_limite,
      ]),
    );
    // O nome do fornecedor é o do cadastro do comerciante da sessão.
    const nomeEsperado = (idDoGabarito: string) =>
      gabarito.fornecedores.find((f) => f.id === idDoGabarito)?.nome;
    expect(
      (saida.valor as unknown as Array<{ fornecedor_nome: string | null }>).map((v) => v.fornecedor_nome),
    ).toEqual(gabarito.variacao_de_custo.map((v) => nomeEsperado(v.fornecedor_id)));
    const acima = await chamar(vilaNova, "get_cost_changes", { filtro: "acima_do_limite" });
    expect(
      (acima.valor as unknown as Array<{ acima_do_limite: boolean }>).every((v) => v.acima_do_limite),
    ).toBe(true);
  });

  it("isolamento: fornecedor de outro comerciante fica sem nome", async () => {
    const [deOutro] = await db
      .select({ id: schema.fornecedor.id })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.comercianteId, vilaNova.comercianteId))
      .limit(1);
    const metricasFalsas = {
      variacoesDeCusto: async () => ({
        valor: [
          {
            produto_id: randomUUID(),
            nome: "Produto",
            fornecedor_id: deOutro!.id,
            custo_anterior_centavos: 100,
            custo_atual_centavos: 110,
            compra_anterior_data: "2026-10-01",
            compra_atual_data: "2026-10-10",
            variacao_bps: 1000,
            variacao_percentual: 10,
            acima_do_limite: true,
            recente: false,
            menor_confianca: 1,
          },
        ],
        periodo: { inicio: "2026-10-01", fim: REF },
        n_registros: 2,
        menor_confianca: 1,
        origens: ["nfe"],
      }),
    } as unknown as MetricasService;
    const ferramenta = criarGetCostChanges(metricasFalsas, db);
    const doDono = (await ferramenta.executar(vilaNova, { filtro: "todos" })) as unknown as Saida;
    const doEsquina = (await ferramenta.executar(esquina, { filtro: "todos" })) as unknown as Saida;
    expect(
      (doDono.valor as unknown as Array<{ fornecedor_nome: string | null }>)[0]?.fornecedor_nome,
    ).toEqual(expect.any(String));
    expect(
      (doEsquina.valor as unknown as Array<{ fornecedor_nome: string | null }>)[0]?.fornecedor_nome,
    ).toBeNull();
  });

  it("isolamento: nenhuma ferramenta devolve produto de outro comerciante", async () => {
    const doEsquina = new Set(
      (
        await db
          .select({ id: schema.produto.id })
          .from(schema.produto)
          .where(eq(schema.produto.comercianteId, esquina.comercianteId))
      ).map((p) => p.id),
    );
    // O Esquina não vende refrigerante: o produto do Vila Nova não pode aparecer para ele.
    const margemDeOutroLojista = await chamar(esquina, "get_product_margin", {
      produto: "Refrigerante cola 2L",
    });
    expect(margemDeOutroLojista).toMatchObject({ ausente: true });
    const resultados = [
      await chamar(esquina, "get_top_products", { criterio: "volume" }),
      await chamar(esquina, "get_cost_changes", {}),
      margemDeOutroLojista,
    ];
    const ids =
      JSON.stringify(resultados).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    const proprios = new Set(skuPorProduto.keys());
    for (const id of ids) {
      if (proprios.has(id)) expect(doEsquina.has(id)).toBe(true);
    }
  });

  describe("escolha entre produtos de mesmo nome (#156)", () => {
    const NOME = "Arroz tipo 1 5kg";
    const CODIGOS = ["7891000100103", "7891000100110"];
    let dono: ContextoSessao;

    beforeAll(async () => {
      const [c] = await db.insert(schema.comerciante).values({ nome: "E2E Nomes Iguais" }).returning();
      dono = { comercianteId: c!.id, nomeComercio: "E2E Nomes Iguais", dataReferencia: REF };
      await db.insert(schema.produto).values(
        CODIGOS.map((codigoBarras) => ({
          comercianteId: c!.id,
          nome: NOME,
          codigoBarras,
          origem: "planilha" as const,
        })),
      );
    });

    afterAll(async () => {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, dono.comercianteId));
    });

    it("o nome devolve os dois candidatos com o código de barras, e o id escolhido resolve", async () => {
      const ambiguo = await chamar(dono, "get_product_margin", { produto: NOME });
      expect(ambiguo.ambiguo).toBe(true);
      expect(ambiguo.candidatos).toHaveLength(2);
      expect((ambiguo.candidatos ?? []).map((c) => c.codigo_barras).sort()).toEqual(CODIGOS);

      const escolhido = ambiguo.candidatos![0]!;
      const saida = await chamar(dono, "get_product_margin", { produto_id: escolhido.produto_id });
      expect(saida.ambiguo).toBeUndefined();
      expect(saida).toMatchObject({ ausente: true, produto_id: escolhido.produto_id, nome: NOME });
    });

    it("id de produto de outro comerciante não vale: produto não encontrado, sem vazar o id", async () => {
      const [deOutro] = await db
        .select({ id: schema.produto.id })
        .from(schema.produto)
        .where(eq(schema.produto.comercianteId, vilaNova.comercianteId))
        .limit(1);
      const saida = await chamar(esquina, "get_product_margin", { produto_id: deOutro!.id });
      expect(saida).toMatchObject({ ausente: true, codigo: "produto_nao_encontrado" });
      expect(JSON.stringify(saida)).not.toContain(deOutro!.id);
    });

    it("o verificador aceita citar o código de barras e bloqueia número que a ferramenta não devolveu", async () => {
      const ambiguo = await chamar(dono, "get_product_margin", { produto: NOME });
      const aut = new NumerosAutorizados([ambiguo]);
      expect(verificarNumeros("É o de código 7891000100103?", aut).aprovado).toBe(true);
      expect(verificarNumeros("É o de código 7891000100999?", aut).aprovado).toBe(false);
    });
  });
});
