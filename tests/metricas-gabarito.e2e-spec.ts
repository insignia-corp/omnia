import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { semear } from "../src/infra/database/seed/semear";
import { PARAMETROS_GIRO } from "../src/metricas/giro";
import { PARAMETROS_MARGEM, type MargemDoProduto } from "../src/metricas/margem-por-produto";
import { MetricasService, type ContextoMetricas } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente, type DadoAusente, type ResultadoMetrica } from "../src/metricas/resultado-metrica";
import type { ResumoDiario } from "../src/metricas/resumo-diario";
import { PARAMETROS_VARIACAO_CUSTO } from "../src/metricas/variacao-de-custo";

/**
 * Teste de regressão das métricas contra o gabarito (issue #41, critério de pronto da Etapa 3).
 * O gabarito é calculado à parte por scripts/fixtures/gabarito.ts, sem usar src/metricas; aqui o
 * seed é carregado no banco e as métricas rodam pelo serviço, como o agente vai chamar.
 */

interface Margem {
  produto_id: string;
  nome: string;
  situacao: "ok" | "sem_custo" | "sem_venda_na_janela";
  preco_medio_venda_centavos: number | null;
  custo_compra_mais_recente_centavos: number | null;
  compra_data: string | null;
  compra_nota: string | null;
  fornecedor_id: string | null;
  margem_bps: number | null;
  margem_percentual: number | null;
  abaixo_da_meta: boolean | null;
  /** O gabarito chama de n_registros as unidades vendidas na janela. */
  n_registros: number;
  menor_confianca: number | null;
}

interface Variacao {
  produto_id: string;
  fornecedor_id: string;
  custo_anterior_centavos: number;
  custo_atual_centavos: number;
  compra_anterior: { data: string };
  compra_atual: { data: string };
  variacao_bps: number;
  variacao_percentual: number;
  acima_do_limite: boolean;
  dispara_alerta: boolean;
  menor_confianca: number;
}

interface GiroGabarito {
  produto_id: string;
  unidades_7_dias: number;
  unidades_28_dias_anteriores: number;
  media_semanal_28_dias: number;
  alta_bps: number | null;
  elegivel_para_alta: boolean;
}

interface ResumoGabarito {
  data: string;
  faturamento_centavos: number;
  gastos_centavos: number;
  saldo_do_dia_centavos: number;
  saldo_da_conta_centavos: number;
  cupons: number;
  ticket_medio_centavos: number | null;
  media_faturamento_7_dias_anteriores_centavos: number;
  variacao_faturamento_bps: number;
}

interface DiaGabarito {
  data: string;
  faturamento_centavos: number;
}

interface Gabarito {
  parametros: {
    data_referencia: string;
    margem: { janela_preco_dias: number };
    variacao_custo: { limite_bps: number; janela_alerta_dias: number };
    giro: { ultimos_dias: number; anteriores_dias: number; minimo_media_semanal: number; top_n: number };
  };
  fornecedores: Array<{ id: string; nome: string }>;
  resumo_diario: { referencia: ResumoGabarito; dia_anterior: ResumoGabarito };
  margem_por_produto: Margem[];
  variacao_de_custo: Variacao[];
  giro: {
    periodo: {
      ultimos_7_dias: { inicio: string; fim: string };
      anteriores_28_dias: { inicio: string; fim: string };
    };
    maior_alta: Array<{ produto_id: string; alta_bps: number | null }>;
    maior_volume: Array<{ produto_id: string; unidades_7_dias: number }>;
    por_produto: GiroGabarito[];
  };
  serie_diaria: DiaGabarito[];
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;
const REF = gabarito.parametros.data_referencia;

const notas = JSON.parse(readFileSync("fixtures/notas/manifesto.json", "utf8")) as Array<{
  id: string;
  arquivo_xml: string | null;
}>;
/** De onde vem o custo: a nota em XML é NF-e, as demais são foto. */
const origemDaNota = (nota: string | null): "nfe" | "foto_nota" =>
  notas.find((n) => n.id === nota)?.arquivo_xml ? "nfe" : "foto_nota";

/** Agrupa um ranking em runs de valores iguais; dentro de cada grupo os produtos saem em ordem de código. */
function gruposDeEmpate(ranking: Array<{ sku: string | undefined; valor: number | null }>): string[][] {
  const grupos: string[][] = [];
  ranking.forEach((item, i) => {
    const sku = item.sku ?? "?";
    if (i > 0 && item.valor === ranking[i - 1]?.valor) grupos.at(-1)?.push(sku);
    else grupos.push([sku]);
  });
  return grupos.map((grupo) => grupo.sort());
}

function valorDe<T>(resultado: ResultadoMetrica<T> | DadoAusente | undefined): ResultadoMetrica<T> {
  if (resultado === undefined) throw new Error("Esperava resultado, veio nada");
  if (ehDadoAusente(resultado)) throw new Error(`Esperava resultado, veio dado ausente: ${resultado.codigo}`);
  return resultado;
}

describe("métricas contra o gabarito (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const servico = new MetricasService(new RepositorioMetricasPostgres(db));

  let vilaNova: ContextoMetricas;
  let esquina: ContextoMetricas;
  const produtoPorSku = new Map<string, string>();
  const skuPorProduto = new Map<string, string>();
  const fornecedorPorGabarito = new Map<string, string>();
  let margens: Awaited<ReturnType<MetricasService["margensDosProdutos"]>>;

  const idDoProduto = (sku: string): string => {
    const id = produtoPorSku.get(sku);
    if (!id) throw new Error(`Produto ${sku} não está no seed`);
    return id;
  };
  const idDoFornecedor = (idDoGabarito: string): string => {
    const id = fornecedorPorGabarito.get(idDoGabarito);
    if (!id) throw new Error(`Fornecedor ${idDoGabarito} não está no seed`);
    return id;
  };
  const margemDe = (sku: string) => margens.find((m) => m.produto_id === idDoProduto(sku))?.resultado;

  beforeAll(async () => {
    await migrar(url);
    const resumo = await semear(db);
    const idDe = (nome: string): string => {
      const linha = resumo.find((r) => r.comerciante === nome);
      if (!linha) throw new Error(`Comerciante ${nome} não está no seed`);
      return linha.comercianteId;
    };
    vilaNova = { comercianteId: idDe("Mercadinho Vila Nova"), dataReferencia: REF };
    esquina = { comercianteId: idDe("Conveniência Esquina 24h"), dataReferencia: REF };

    const produtos = await db
      .select({ id: schema.produto.id, sku: schema.produto.sku })
      .from(schema.produto)
      .where(eq(schema.produto.comercianteId, vilaNova.comercianteId));
    for (const p of produtos) {
      if (!p.sku) continue;
      produtoPorSku.set(p.sku, p.id);
      skuPorProduto.set(p.id, p.sku);
    }
    const fornecedores = await db
      .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.comercianteId, vilaNova.comercianteId));
    for (const f of gabarito.fornecedores) {
      const linha = fornecedores.find((x) => x.nome === f.nome);
      if (linha) fornecedorPorGabarito.set(f.id, linha.id);
    }
    margens = await servico.margensDosProdutos(vilaNova);
  });
  afterAll(() => pool.end());

  it("os parâmetros padrão são os do gabarito", () => {
    expect(PARAMETROS_MARGEM.janelaPrecoDias).toBe(gabarito.parametros.margem.janela_preco_dias);
    expect(PARAMETROS_VARIACAO_CUSTO.limiteBps).toBe(gabarito.parametros.variacao_custo.limite_bps);
    expect(PARAMETROS_VARIACAO_CUSTO.janelaAlertaDias).toBe(
      gabarito.parametros.variacao_custo.janela_alerta_dias,
    );
    expect(PARAMETROS_GIRO.minimoMediaSemanal).toBe(gabarito.parametros.giro.minimo_media_semanal);
    expect(PARAMETROS_GIRO.topN).toBe(gabarito.parametros.giro.top_n);
  });

  describe("margem por produto (#33)", () => {
    it("cobre os 50 produtos do gabarito, sem sobrar nem faltar", () => {
      expect(margens.map((m) => skuPorProduto.get(m.produto_id)).sort()).toEqual(
        gabarito.margem_por_produto.map((m) => m.produto_id).sort(),
      );
    });

    it.each(gabarito.margem_por_produto.map((m) => [`${m.produto_id} ${m.nome}`, m] as const))(
      "%s",
      (_nome, esperado) => {
        const obtido = margemDe(esperado.produto_id);
        if (esperado.situacao !== "ok") {
          expect(obtido).toMatchObject({ ausente: true, codigo: esperado.situacao });
          return;
        }
        const r = valorDe<MargemDoProduto>(obtido);
        expect(r.valor).toMatchObject({
          preco_medio_venda_centavos: esperado.preco_medio_venda_centavos,
          custo_compra_mais_recente_centavos: esperado.custo_compra_mais_recente_centavos,
          compra_data: esperado.compra_data,
          fornecedor_id: idDoFornecedor(esperado.fornecedor_id ?? ""),
          margem_bps: esperado.margem_bps,
          margem_percentual: esperado.margem_percentual,
          abaixo_da_meta: esperado.abaixo_da_meta,
          unidades_vendidas: esperado.n_registros,
        });
        expect(r.menor_confianca).toBe(esperado.menor_confianca);
        // A venda vem da planilha e o custo da nota: a margem diz de onde saiu cada lado.
        expect(r.origens).toEqual([origemDaNota(esperado.compra_nota), "planilha"].sort());
        expect(r.periodo).toEqual({ inicio: "2026-09-20", fim: REF });
        expect(r.n_registros).toBeGreaterThan(1);
      },
    );

    it("sem custo, a métrica pede o custo ao dono em vez de estimar", () => {
      const sem = gabarito.margem_por_produto.filter((m) => m.situacao === "sem_custo");
      expect(sem.length).toBeGreaterThan(0);
      for (const esperado of sem) {
        expect(margemDe(esperado.produto_id)).toMatchObject({
          ausente: true,
          codigo: "sem_custo",
          pergunta_sugerida: expect.stringContaining(esperado.nome),
        });
      }
    });

    it("a consulta de um produto dá o mesmo resultado que a de todos", async () => {
      for (const sku of ["P01", "P12", "P17", "P20"]) {
        expect(await servico.margemDoProduto(vilaNova, idDoProduto(sku))).toEqual(margemDe(sku));
      }
    });

    it("a margem do arroz cai para 20,26% e a do óleo para 23,18%, abaixo da meta de 25%", () => {
      const arroz = valorDe<MargemDoProduto>(margemDe("P01"));
      const oleo = valorDe<MargemDoProduto>(margemDe("P03"));
      expect(arroz.valor).toMatchObject({
        margem_percentual: 20.26,
        meta_percentual: 25,
        abaixo_da_meta: true,
      });
      expect(oleo.valor).toMatchObject({
        margem_percentual: 23.18,
        meta_percentual: 25,
        abaixo_da_meta: true,
      });
    });
  });

  describe("variação de custo (#35)", () => {
    let variacoes: Awaited<ReturnType<MetricasService["variacoesDeCusto"]>>;
    beforeAll(async () => {
      variacoes = await servico.variacoesDeCusto(vilaNova);
    });

    it("lista as mesmas variações do gabarito, na mesma ordem, e nenhuma a mais", () => {
      expect(variacoes.valor.map((v) => skuPorProduto.get(v.produto_id))).toEqual(
        gabarito.variacao_de_custo.map((v) => v.produto_id),
      );
    });

    it.each(gabarito.variacao_de_custo.map((v) => [v.produto_id, v] as const))("%s", (_sku, esperado) => {
      const obtido = variacoes.valor.find((v) => v.produto_id === idDoProduto(esperado.produto_id));
      expect(obtido).toMatchObject({
        fornecedor_id: idDoFornecedor(esperado.fornecedor_id),
        custo_anterior_centavos: esperado.custo_anterior_centavos,
        custo_atual_centavos: esperado.custo_atual_centavos,
        compra_anterior_data: esperado.compra_anterior.data,
        compra_atual_data: esperado.compra_atual.data,
        variacao_bps: esperado.variacao_bps,
        variacao_percentual: esperado.variacao_percentual,
        acima_do_limite: esperado.acima_do_limite,
        menor_confianca: esperado.menor_confianca,
      });
      expect(Boolean(obtido?.acima_do_limite && obtido.recente)).toBe(esperado.dispara_alerta);
    });

    it("detecta os reajustes plantados (arroz e óleo) e não acusa o arroz do outro fornecedor", () => {
      const disparam = variacoes.valor
        .filter((v) => v.acima_do_limite && v.recente)
        .map((v) => skuPorProduto.get(v.produto_id))
        .sort();
      expect(disparam).toEqual(["P01", "P03"]);
      expect(variacoes.valor.filter((v) => v.produto_id === idDoProduto("P01"))).toHaveLength(1);
    });
  });

  describe("maior giro (#34)", () => {
    let giro: Awaited<ReturnType<MetricasService["giro"]>>;
    beforeAll(async () => {
      giro = await servico.giro(vilaNova);
    });

    it("usa as mesmas janelas do gabarito", () => {
      expect(giro.valor.periodos.ultimos_7_dias).toEqual(gabarito.giro.periodo.ultimos_7_dias);
      expect(giro.valor.periodos.anteriores_28_dias).toEqual(gabarito.giro.periodo.anteriores_28_dias);
    });

    it.each(gabarito.giro.por_produto.map((g) => [g.produto_id, g] as const))("%s", (_sku, esperado) => {
      const obtido = giro.valor.por_produto.find((g) => g.produto_id === idDoProduto(esperado.produto_id));
      expect(obtido).toMatchObject({
        unidades_7_dias: esperado.unidades_7_dias,
        unidades_28_dias_anteriores: esperado.unidades_28_dias_anteriores,
        media_semanal_28_dias: esperado.media_semanal_28_dias,
        alta_bps: esperado.alta_bps,
        elegivel_para_alta: esperado.elegivel_para_alta,
      });
    });

    // O gabarito desempata pelo id do fixture, que o banco não tem. A ordem entre produtos de valores
    // diferentes e o conjunto de cada grupo de empatados têm de bater; a ordem dentro do grupo é
    // decisão do código (por nome) e está nos testes unitários.
    it("os 5 de maior alta são os do gabarito, na mesma ordem", () => {
      expect(
        gruposDeEmpate(
          giro.valor.maior_alta.map((g) => ({ sku: skuPorProduto.get(g.produto_id), valor: g.alta_bps })),
        ),
      ).toEqual(
        gruposDeEmpate(gabarito.giro.maior_alta.map((g) => ({ sku: g.produto_id, valor: g.alta_bps }))),
      );
    });

    it("os 5 de maior volume são os do gabarito, na mesma ordem", () => {
      expect(
        gruposDeEmpate(
          giro.valor.maior_volume.map((g) => ({
            sku: skuPorProduto.get(g.produto_id),
            valor: g.unidades_7_dias,
          })),
        ),
      ).toEqual(
        gruposDeEmpate(
          gabarito.giro.maior_volume.map((g) => ({ sku: g.produto_id, valor: g.unidades_7_dias })),
        ),
      );
    });
  });

  describe("resumo diário (#40)", () => {
    const casos: Array<[string, ResumoGabarito]> = [
      ["dia de referência", gabarito.resumo_diario.referencia],
      ["dia anterior", gabarito.resumo_diario.dia_anterior],
    ];

    it.each(casos)("%s bate com o gabarito", async (_rotulo, esperado) => {
      const r = valorDe(await servico.resumoDiario(vilaNova, esperado.data));
      expect(r.valor).toMatchObject({
        data: esperado.data,
        faturamento_centavos: esperado.faturamento_centavos,
        gastos_centavos: esperado.gastos_centavos,
        saldo_do_dia_centavos: esperado.saldo_do_dia_centavos,
        saldo_da_conta: { saldo_centavos: esperado.saldo_da_conta_centavos },
        cupons: esperado.cupons,
        ticket_medio_centavos: esperado.ticket_medio_centavos,
        comparacao_faturamento: {
          media_7_dias_anteriores: {
            base_centavos: esperado.media_faturamento_7_dias_anteriores_centavos,
            variacao_bps: esperado.variacao_faturamento_bps,
          },
        },
      });
    });

    it.each(casos)(
      "%s: compara com o dia anterior e com o mesmo dia da semana anterior",
      async (_rotulo, esperado) => {
        const r = valorDe<ResumoDiario>(await servico.resumoDiario(vilaNova, esperado.data));
        const faturamentoDe = (data: string): number => {
          const dia = gabarito.serie_diaria.find((d) => d.data === data);
          if (!dia) throw new Error(`Sem ${data} na série do gabarito`);
          return dia.faturamento_centavos;
        };
        const indice = gabarito.serie_diaria.findIndex((d) => d.data === esperado.data);
        const anterior = gabarito.serie_diaria[indice - 1];
        const mesmoDia = gabarito.serie_diaria[indice - 7];
        if (!anterior || !mesmoDia) throw new Error("Série curta demais");
        const variacaoBps = (base: number): number =>
          Math.round(((faturamentoDe(esperado.data) - base) * 10_000) / base);

        expect(r.valor.comparacao_faturamento.dia_anterior).toMatchObject({
          data: anterior.data,
          base_centavos: anterior.faturamento_centavos,
          variacao_bps: variacaoBps(anterior.faturamento_centavos),
        });
        expect(r.valor.comparacao_faturamento.mesmo_dia_semana_anterior).toMatchObject({
          data: mesmoDia.data,
          base_centavos: mesmoDia.faturamento_centavos,
          variacao_bps: variacaoBps(mesmoDia.faturamento_centavos),
        });
      },
    );

    it("dia depois da última venda importada não vira faturamento zero", async () => {
      expect(await servico.resumoDiario(vilaNova, "2026-10-20")).toMatchObject({
        ausente: true,
        codigo: "dia_sem_dados",
      });
    });
  });

  describe("isolamento entre lojistas", () => {
    const consultar = async <T extends Record<string, unknown>>(texto: string, valores: unknown[]) =>
      (await pool.query<T>(texto, valores)).rows;

    it("produto de outro lojista não é encontrado", async () => {
      expect(await servico.margemDoProduto(esquina, idDoProduto("P01"))).toMatchObject({
        ausente: true,
        codigo: "produto_nao_encontrado",
      });
    });

    it("id que não é UUID também vira produto não encontrado, sem erro de banco", async () => {
      expect(await servico.margemDoProduto(vilaNova, "'; drop table produto; --")).toMatchObject({
        ausente: true,
        codigo: "produto_nao_encontrado",
      });
    });

    it("todos os produtos citados nas métricas da Esquina são dela", async () => {
      const dela = new Set(
        (
          await consultar<{ id: string }>("select id from produto where comerciante_id = $1", [
            esquina.comercianteId,
          ])
        ).map((p) => p.id),
      );
      const margensEsquina = await servico.margensDosProdutos(esquina);
      const variacoes = await servico.variacoesDeCusto(esquina);
      const giro = await servico.giro(esquina);
      expect(dela.size).toBe(12);
      expect(margensEsquina).toHaveLength(12);
      for (const id of [
        ...margensEsquina.map((m) => m.produto_id),
        ...variacoes.valor.map((v) => v.produto_id),
        ...giro.valor.por_produto.map((g) => g.produto_id),
      ]) {
        expect(dela.has(id)).toBe(true);
      }
    });

    it("o resumo da Esquina soma só as vendas e as saídas dela", async () => {
      const [vendas] = await consultar<{ faturamento: string; cupons: string }>(
        "select sum(total_centavos) as faturamento, count(*) as cupons from venda where comerciante_id = $1 and data = $2",
        [esquina.comercianteId, REF],
      );
      const [saidas] = await consultar<{ gastos: string | null }>(
        "select sum(valor_centavos) as gastos from transacao where comerciante_id = $1 and data = $2 and tipo = 'saida'",
        [esquina.comercianteId, REF],
      );
      const r = valorDe(await servico.resumoDiario(esquina));
      expect(r.valor.faturamento_centavos).toBe(Number(vendas?.faturamento));
      expect(r.valor.cupons).toBe(Number(vendas?.cupons));
      expect(r.valor.gastos_centavos).toBe(Number(saidas?.gastos ?? 0));
      expect(r.valor.faturamento_centavos).not.toBe(gabarito.resumo_diario.referencia.faturamento_centavos);
    });
  });
});
