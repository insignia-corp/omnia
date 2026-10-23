import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { montarCatalogo } from "../../src/agente/ferramentas/catalogo";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import { RegistroFerramentas } from "../../src/agente/ferramentas/registro-ferramentas";
import { criarGetCostChanges } from "../../src/agente/ferramentas/plano-a/get-cost-changes";
import { somarDias } from "../../src/lib/datas/datas";
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
/** As janelas de get_top_products terminam ontem: a referência do gabarito é o último dia com vendas, então a execução é a do dia seguinte. */
const DIA_DA_EXECUCAO = somarDias(REF, 1);

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
    const volume = await chamar({ ...vilaNova, dataReferencia: DIA_DA_EXECUCAO }, "get_top_products", {
      criterio: "volume",
    });
    const produtosVolume = volume.valor.produtos as Array<{ produto_id: string; unidades_7_dias: number }>;
    expect(produtosVolume.map((p) => [skuPorProduto.get(p.produto_id), p.unidades_7_dias])).toEqual(
      gabarito.giro.maior_volume.map((p) => [p.produto_id, p.unidades_7_dias]),
    );
    const alta = await chamar({ ...vilaNova, dataReferencia: DIA_DA_EXECUCAO }, "get_top_products", {
      criterio: "alta",
    });
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

  describe("aliases confirmados e produtos de mesmo nome (#156)", () => {
    // Id novo a cada execução (a chave é global), com "99" no segundo grupo.
    const ID_COM_99 = `f0e1d2c3-99ab-4cde-8f01-${randomUUID().slice(-12)}`;
    let loja: ContextoSessao;
    let produtoB = "";
    let sabonete = "";
    let arrozBranco = "";

    const nomeAchado = (saida: Saida & { nome?: string }) =>
      (saida.valor as { nome?: string } | undefined)?.nome ?? saida.nome;

    beforeAll(async () => {
      const [dono] = await db.insert(schema.comerciante).values({ nome: "E2E Margem 156" }).returning();
      loja = { comercianteId: dono!.id, nomeComercio: "E2E Margem 156", dataReferencia: REF };
      const base = { comercianteId: dono!.id, origem: "dono" as const };
      const produtos = await db
        .insert(schema.produto)
        .values([
          { ...base, id: ID_COM_99, nome: "Feijão Preto 1kg", sku: "FP-1", codigoBarras: "7891000100103" },
          { ...base, nome: "Feijão Preto 1kg", sku: "FP-2" },
          { ...base, nome: "Sabonete Neutro 85g", sku: "SB-1" },
          { ...base, nome: "Arroz Branco Tipo 1 5kg", sku: "AR-1" },
          { ...base, nome: "Arroz Integral 1kg", sku: "AR-2" },
          { ...base, nome: "Suco de Uva 1L", sku: "SU-1" },
          { ...base, nome: "Suco de Uva 300ml", sku: "SU-2" },
          // Produtos com nome e apelido ao mesmo tempo: o apelido de MG-1 e MG-2 é pior que o nome, o de MG-3 empata.
          { ...base, nome: "Margarina Cremosa 500g", sku: "MG-1" },
          { ...base, nome: "Margarina Cremosa 500g", sku: "MG-2" },
          { ...base, nome: "Margarina Cremosa 500g", sku: "MG-3" },
          // O apelido de LL-1 ganha pela palavra ("leite integral" inteiro dentro dele) e perde pelo nome inteiro.
          { ...base, nome: "Leite Longa Vida Integral", sku: "LL-1" },
          { ...base, nome: "Leite Longa Vida Integral", sku: "LL-2" },
          // 01:30 UTC de 02/10 ainda é 01/10 em Brasília: a data mostrada ao dono é a do fuso dele.
          { ...base, nome: "Pão Francês 50g", sku: "PF-1", criadoEm: new Date("2026-10-02T01:30:00Z") },
          { ...base, nome: "Pão Francês 50g", sku: "PF-2", criadoEm: new Date("2026-10-02T12:00:00Z") },
        ])
        .returning();
      produtoB = produtos.find((p) => p.sku === "FP-2")!.id;
      sabonete = produtos.find((p) => p.sku === "SB-1")!.id;
      arrozBranco = produtos.find((p) => p.sku === "AR-1")!.id;
      const vinculo = { comercianteId: dono!.id, produtoId: sabonete, metodo: "dono" as const, confianca: 1 };
      await db.insert(schema.vinculoDescricaoProduto).values([
        { ...vinculo, descricaoNormalizada: "SAB LIQ YPE COCO 5L", confirmadoPeloDono: true },
        { ...vinculo, descricaoNormalizada: "DESCRICAO NAO CONFIRMADA XPTO", confirmadoPeloDono: false },
        { ...vinculo, produtoId: arrozBranco, descricaoNormalizada: "ARROZ", confirmadoPeloDono: true },
      ]);
      // Dois produtos com o mesmo apelido confirmado: a busca pelo apelido empata e mostra a descrição que casou.
      const apelidos: Record<string, string> = {
        "SU-1": "SUCO UVA INTEGRAL",
        "SU-2": "SUCO UVA INTEGRAL",
        "MG-1": "MARG QUALY CREMOSA",
        "MG-2": "MARG QUALY CREMOSA",
        "MG-3": "MARGARINA CREMOSA 500G",
        "LL-1": "LEITE INTEGRAL CAIXA COM 12 UNIDADES",
      };
      // Em um insert só: os apelidos iguais são gravados juntos (mesmo criado_em), então empatam em vez de um
      // substituir o outro como numa correção do dono.
      await db.insert(schema.vinculoDescricaoProduto).values(
        Object.entries(apelidos).map(([sku, apelido]) => ({
          ...vinculo,
          produtoId: produtos.find((p) => p.sku === sku)!.id,
          descricaoNormalizada: apelido,
          confirmadoPeloDono: true,
        })),
      );
    });

    // Sem limpeza: o histórico de vínculos é só de acréscimo (regra 10), e cada execução usa um comerciante novo.

    it("a descrição de nota que o dono confirmou acha o produto", async () => {
      const saida = await chamar(loja, "get_product_margin", { produto: "sab liq ype coco" });
      expect(saida.ambiguo).toBeUndefined();
      expect(nomeAchado(saida)).toBe("Sabonete Neutro 85g");
    });

    it("apelido confirmado que casa por inteiro decide, mesmo quando o nome empata na palavra", async () => {
      const saida = await chamar(loja, "get_product_margin", { produto: "arroz" });
      expect(saida.ambiguo).toBeUndefined();
      expect(nomeAchado(saida)).toBe("Arroz Branco Tipo 1 5kg");
      expect((saida as unknown as { produto_id?: string }).produto_id).toBe(arrozBranco);
    });

    it("candidatos mostram a descrição de nota quando o apelido supera o nome, e nada quando o nome vence", async () => {
      const porApelido = await chamar(loja, "get_product_margin", { produto: "suco uva integral" });
      expect(porApelido.ambiguo).toBe(true);
      const candidatos = (porApelido.candidatos ?? []) as unknown as Array<{
        sku: string;
        descricao_de_nota: string | null;
      }>;
      const doApelido = candidatos.filter((c) => ["SU-1", "SU-2"].includes(c.sku));
      expect(doApelido).toHaveLength(2);
      expect(doApelido.map((c) => c.descricao_de_nota)).toEqual(["SUCO UVA INTEGRAL", "SUCO UVA INTEGRAL"]);

      const porNome = await chamar(loja, "get_product_margin", { produto: "Feijão Preto 1kg" });
      const doNome = (porNome.candidatos ?? []) as unknown as Array<{ descricao_de_nota: string | null }>;
      expect(doNome).toHaveLength(2);
      expect(doNome.every((c) => c.descricao_de_nota === null)).toBe(true);

      // Nome e apelido no mesmo produto: o nome vence (apelido pior) ou empata (apelido igual ao nome). A busca
      // não repete o apelido de MG-3 por inteiro, que ligaria sozinha ao produto do vínculo.
      const comApelido = await chamar(loja, "get_product_margin", { produto: "Margarina Cremosa 500" });
      const margarinas = (comApelido.candidatos ?? []) as unknown as Array<{
        sku: string;
        descricao_de_nota: string | null;
      }>;
      expect(margarinas.map((c) => c.sku).sort()).toEqual(["MG-1", "MG-2", "MG-3"]);
      expect(margarinas.every((c) => c.descricao_de_nota === null)).toBe(true);
    });

    it("a descrição mostrada segue o critério da decisão: apelido que ganha só pela palavra não aparece quando o nome inteiro chega ao limite", async () => {
      // Para "leite integral", o nome de LL-1 chega ao limite pelo nome inteiro (0,60) e o apelido só pela
      // palavra (1,00 contra 0,42 no nome inteiro). A decisão usa o nome inteiro, então o apelido não a justifica.
      const saida = await chamar(loja, "get_product_margin", { produto: "leite integral" });
      expect(saida.ambiguo).toBe(true);
      const candidatos = (saida.candidatos ?? []) as unknown as Array<{
        sku: string;
        descricao_de_nota: string | null;
      }>;
      const leites = candidatos.filter((c) => c.sku.startsWith("LL-"));
      expect(leites.map((c) => c.sku).sort()).toEqual(["LL-1", "LL-2"]);
      expect(leites.every((c) => c.descricao_de_nota === null)).toBe(true);
    });

    it("a data de cadastro do candidato é a do fuso do dono, não a UTC", async () => {
      const saida = await chamar(loja, "get_product_margin", { produto: "Pão Francês 50g" });
      const candidatos = (saida.candidatos ?? []) as unknown as Array<{ sku: string; cadastrado_em: string }>;
      expect(Object.fromEntries(candidatos.map((c) => [c.sku, c.cadastrado_em]))).toEqual({
        "PF-1": "2026-10-01",
        "PF-2": "2026-10-02",
      });
    });

    it("descrição não confirmada não vale", async () => {
      const saida = await chamar(loja, "get_product_margin", { produto: "descricao nao confirmada xpto" });
      expect(saida).toMatchObject({ ausente: true, codigo: "produto_nao_encontrado" });
    });

    it("produtos de mesmo nome: candidatos distinguíveis e o id escolhido resolve na segunda chamada", async () => {
      const ambiguo = await chamar(loja, "get_product_margin", { produto: "Feijão Preto 1kg" });
      expect(ambiguo.ambiguo).toBe(true);
      const candidatos = (ambiguo.candidatos ?? []) as unknown as Array<{
        produto_id: string;
        sku: string | null;
        codigo_barras: string | null;
        cadastrado_em: string;
      }>;
      expect(candidatos.map((c) => c.sku).sort()).toEqual(["FP-1", "FP-2"]);
      expect(candidatos.find((c) => c.sku === "FP-1")?.codigo_barras).toBe("7891000100103");
      expect(candidatos[0]?.cadastrado_em).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const escolhido = await chamar(loja, "get_product_margin", {
        produto: "Feijão Preto 1kg",
        produto_id: produtoB,
      });
      expect(escolhido.ambiguo).toBeUndefined();
      expect(nomeAchado(escolhido)).toBe("Feijão Preto 1kg");
      // Sem custo no produto novo, o resultado é a ausência com o id escolhido: prova que foi o B.
      expect((escolhido as unknown as { produto_id?: string }).produto_id).toBe(produtoB);
    });

    it("regra 8: o id do produto (com 99) não autoriza o 99 numa mensagem", async () => {
      const ambiguo = await chamar(loja, "get_product_margin", { produto: "Feijão Preto 1kg" });
      expect(JSON.stringify(ambiguo)).toContain(ID_COM_99);
      expect(verificarNumeros("O feijão subiu 99%.", new NumerosAutorizados([ambiguo])).aprovado).toBe(false);
    });

    it("isolamento: id e descrição de outro comerciante não valem", async () => {
      const deOutro = await chamar(vilaNova, "get_product_margin", {
        produto: "Feijão Preto 1kg",
        produto_id: produtoB,
      });
      expect(deOutro).toMatchObject({ ausente: true, codigo: "produto_nao_encontrado" });
      // Nem o id nem o nome do produto de outro lojista aparecem na resposta.
      expect(JSON.stringify(deOutro)).not.toContain(produtoB);
      expect(JSON.stringify(deOutro)).not.toContain("Feijão");
      expect(
        await chamar(vilaNova, "get_product_margin", { produto: "Sabonete", produto_id: sabonete }),
      ).toMatchObject({
        ausente: true,
      });
      const alias = await chamar(vilaNova, "get_product_margin", { produto: "sab liq ype coco" });
      expect(nomeAchado(alias)).not.toBe("Sabonete Neutro 85g");
      expect(await chamar(loja, "get_product_margin", { produto: "Refrigerante cola 2L" })).toMatchObject({
        ausente: true,
      });
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
      await chamar({ ...esquina, dataReferencia: DIA_DA_EXECUCAO }, "get_top_products", {
        criterio: "volume",
      }),
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
    let produtoIds: string[];

    beforeAll(async () => {
      const [c] = await db.insert(schema.comerciante).values({ nome: "E2E Nomes Iguais" }).returning();
      dono = { comercianteId: c!.id, nomeComercio: "E2E Nomes Iguais", dataReferencia: REF };
      const linhas = await db
        .insert(schema.produto)
        .values(
          CODIGOS.map((codigoBarras) => ({
            comercianteId: c!.id,
            nome: NOME,
            codigoBarras,
            origem: "planilha" as const,
          })),
        )
        .returning({ id: schema.produto.id, codigoBarras: schema.produto.codigoBarras });
      produtoIds = CODIGOS.map((codigo) => linhas.find((l) => l.codigoBarras === codigo)!.id);
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
      const saida = await chamar(dono, "get_product_margin", {
        produto: NOME,
        produto_id: escolhido.produto_id,
      });
      expect(saida.ambiguo).toBeUndefined();
      expect(saida).toMatchObject({ ausente: true, produto_id: escolhido.produto_id, nome: NOME });
    });

    it("id de produto de outro comerciante não vale: produto não encontrado, sem vazar o id", async () => {
      const [deOutro] = await db
        .select({ id: schema.produto.id })
        .from(schema.produto)
        .where(eq(schema.produto.comercianteId, vilaNova.comercianteId))
        .limit(1);
      const saida = await chamar(esquina, "get_product_margin", {
        produto: "arroz",
        produto_id: deOutro!.id,
      });
      expect(saida).toMatchObject({ ausente: true, codigo: "produto_nao_encontrado" });
      expect(JSON.stringify(saida)).not.toContain(deOutro!.id);
    });

    it("o verificador aceita citar o código de barras e bloqueia número que a ferramenta não devolveu", async () => {
      const ambiguo = await chamar(dono, "get_product_margin", { produto: NOME });
      const aut = new NumerosAutorizados([ambiguo]);
      expect(verificarNumeros("É o de código 7891000100103?", aut).aprovado).toBe(true);
      expect(verificarNumeros("É o de código 7891000100999?", aut).aprovado).toBe(false);
    });

    it("descrição confirmada pelo dono desempata nomes iguais: liga sozinho ao produto do vínculo", async () => {
      await db.insert(schema.vinculoDescricaoProduto).values({
        comercianteId: dono.comercianteId,
        descricaoNormalizada: "ARROZ TIPO 1 5KG",
        produtoId: produtoIds[0]!,
        metodo: "dono",
        confianca: 1,
        confirmadoPeloDono: true,
      });
      const saida = await chamar(dono, "get_product_margin", { produto: "arroz tipo 1 5kg" });
      expect(saida.ambiguo).toBeUndefined();
      expect(saida).toMatchObject({ ausente: true, produto_id: produtoIds[0], nome: NOME });
    });
  });

  describe("vínculos por fornecedor e correção do dono (revisão do Codex no PR 164)", () => {
    let loja: ContextoSessao;
    let integral = "";
    let desnatado = "";
    let fornecedores: string[] = [];

    beforeAll(async () => {
      const [c] = await db.insert(schema.comerciante).values({ nome: "E2E Vinculos" }).returning();
      loja = { comercianteId: c!.id, nomeComercio: "E2E Vinculos", dataReferencia: REF };
      const produtos = await db
        .insert(schema.produto)
        .values(
          ["Leite integral 1L", "Leite desnatado 1L"].map((nome) => ({
            comercianteId: c!.id,
            nome,
            origem: "planilha" as const,
          })),
        )
        .returning({ id: schema.produto.id, nome: schema.produto.nome });
      integral = produtos.find((p) => p.nome === "Leite integral 1L")!.id;
      desnatado = produtos.find((p) => p.nome === "Leite desnatado 1L")!.id;
      const fs = await db
        .insert(schema.fornecedor)
        .values(
          ["Distribuidora Um", "Distribuidora Dois"].map((nome) => ({
            comercianteId: c!.id,
            nome,
            origem: "dono" as const,
          })),
        )
        .returning({ id: schema.fornecedor.id });
      fornecedores = fs.map((f) => f.id);
    });

    afterAll(async () => {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, loja.comercianteId));
    });

    const vincular = (
      descricaoNormalizada: string,
      produtoId: string,
      fornecedorId: string,
      criadoEm: string,
    ) =>
      db.insert(schema.vinculoDescricaoProduto).values({
        comercianteId: loja.comercianteId,
        fornecedorId,
        descricaoNormalizada,
        produtoId,
        metodo: "dono",
        confianca: 1,
        confirmadoPeloDono: true,
        criadoEm: new Date(criadoEm),
      });

    it("a mesma descrição em fornecedores diferentes para produtos diferentes vira pergunta, não escolha", async () => {
      await vincular("LEITE UHT CX", integral, fornecedores[0]!, "2026-10-01T10:00:00Z");
      await vincular("LEITE UHT CX", desnatado, fornecedores[1]!, "2026-10-02T10:00:00Z");
      const saida = await chamar(loja, "get_product_margin", { produto: "leite uht cx" });
      expect(saida.ambiguo).toBe(true);
      expect((saida.candidatos ?? []).map((c) => c.produto_id).sort()).toEqual([integral, desnatado].sort());
    });

    it("correção do dono vale na busca aproximada: o apelido antigo fica só no histórico", async () => {
      await vincular("LEITE LONGA VIDA TP", integral, fornecedores[0]!, "2026-10-01T10:00:00Z");
      await vincular("LEITE LONGA VIDA TP", desnatado, fornecedores[0]!, "2026-10-03T10:00:00Z");
      const saida = await chamar(loja, "get_product_margin", { produto: "leite longa vida" });
      expect(saida.ambiguo).toBeUndefined();
      expect(saida).toMatchObject({ produto_id: desnatado });
      // O histórico não é apagado (regra 10): as duas linhas continuam na tabela.
      const linhas = await db
        .select()
        .from(schema.vinculoDescricaoProduto)
        .where(eq(schema.vinculoDescricaoProduto.descricaoNormalizada, "LEITE LONGA VIDA TP"));
      expect(linhas).toHaveLength(2);
    });
  });

  describe("descrições confirmadas da nota", () => {
    const achado = (saida: Saida & { nome?: string }) =>
      (saida.valor as { nome?: string } | undefined)?.nome ?? saida.nome;

    it.each([
      ["leite uht", "Leite integral 1L"],
      ["salg milho", "Salgadinho de milho 100g"],
    ])("%s, como vem na nota, liga a %s", async (digitado, esperado) => {
      const saida = await chamar(vilaNova, "get_product_margin", { produto: digitado });
      expect(saida.ambiguo).toBeUndefined();
      expect(achado(saida)).toBe(esperado);
    });

    it("descrição confirmada igual à digitada liga com confiança 1", async () => {
      const saida = await chamar(vilaNova, "get_product_margin", { produto: "REFRIG COLA LT 350ML" });
      expect(saida.confianca_da_busca).toBe(1);
      expect(achado(saida)).toBe("Refrigerante cola lata 350ml");
    });
  });
});
