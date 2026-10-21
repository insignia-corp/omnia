import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { montarCatalogo } from "../src/agente/ferramentas/catalogo";
import type { ContextoSessao } from "../src/agente/ferramentas/ferramenta";
import { RegistroFerramentas } from "../src/agente/ferramentas/registro-ferramentas";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { semear } from "../src/infra/database/seed/semear";
import { NumerosAutorizados, verificarNumeros } from "../src/lib/verificador-numeros/verificador-numeros";
import { PARAMETROS_RECEITA } from "../src/metricas/receita-por-produto";
import { MetricasService } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente } from "../src/metricas/resultado-metrica";

/**
 * Receita por produto (issue #148) contra o gabarito. A seção `receita_por_produto` de
 * fixtures/gabarito/metricas.json é calculada por scripts/fixtures/gabarito.ts sem usar src/metricas.
 */

interface ReceitaGabarito {
  produto_id: string;
  nome: string;
  receita_centavos: number;
}
interface Gabarito {
  parametros: { data_referencia: string; receita_por_produto: { janela_dias: number; top_n: number } };
  receita_por_produto: {
    periodo: { inicio: string; fim: string };
    maior_receita: ReceitaGabarito[];
    por_produto: ReceitaGabarito[];
  };
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;
const REF = gabarito.parametros.data_referencia;

describe("receita por produto contra o gabarito (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const servico = new MetricasService(new RepositorioMetricasPostgres(db));
  const registro = new RegistroFerramentas(montarCatalogo({ db }));

  let vilaNova: ContextoSessao;
  let esquina: ContextoSessao;
  const skuPorProduto = new Map<string, string>();

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

  it("os parâmetros são os do gabarito", () => {
    expect(PARAMETROS_RECEITA.topN).toBe(gabarito.parametros.receita_por_produto.top_n);
  });

  it("a métrica devolve a receita de cada produto e o ranking do gabarito", async () => {
    const r = await servico.receitaPorProduto(vilaNova);
    if (ehDadoAusente(r)) throw new Error("dado ausente inesperado");
    expect(r.valor.periodo).toEqual(gabarito.receita_por_produto.periodo);
    const porSku = (lista: Array<{ produto_id: string; receita_centavos: number }>) =>
      lista.map((p) => [skuPorProduto.get(p.produto_id), p.receita_centavos]);
    expect(porSku(r.valor.por_produto).sort()).toEqual(
      gabarito.receita_por_produto.por_produto.map((p) => [p.produto_id, p.receita_centavos]).sort(),
    );
    expect(porSku(r.valor.maior_receita)).toEqual(
      gabarito.receita_por_produto.maior_receita.map((p) => [p.produto_id, p.receita_centavos]),
    );
    expect(r.menor_confianca).toEqual(expect.any(Number));
    expect(r.n_registros).toBeGreaterThan(0);
  });

  it("get_top_products com criterio receita devolve o ranking do gabarito, e o verificador aceita os valores", async () => {
    const saida = await registro.executar(vilaNova, "get_top_products", { criterio: "receita" });
    if (!saida.ok) throw new Error(saida.erro);
    const resultado = saida.saida as {
      valor: { criterio: string; produtos: Array<{ produto_id: string; receita_centavos: number }> };
    };
    expect(resultado.valor.criterio).toBe("receita");
    expect(
      resultado.valor.produtos.map((p) => [skuPorProduto.get(p.produto_id), p.receita_centavos]),
    ).toEqual(gabarito.receita_por_produto.maior_receita.map((p) => [p.produto_id, p.receita_centavos]));
    const maior = gabarito.receita_por_produto.maior_receita[0]!;
    const reais = (maior.receita_centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    const autorizados = new NumerosAutorizados([resultado]);
    expect(verificarNumeros(`${maior.nome} faturou R$ ${reais}.`, autorizados).aprovado).toBe(true);
    expect(verificarNumeros(`${maior.nome} faturou R$ ${reais}1.`, autorizados).aprovado).toBe(false);
  });

  it("isolamento: o ranking do outro comerciante só tem produtos dele", async () => {
    const doEsquina = new Set(
      (
        await db
          .select({ id: schema.produto.id })
          .from(schema.produto)
          .where(eq(schema.produto.comercianteId, esquina.comercianteId))
      ).map((p) => p.id),
    );
    const r = await servico.receitaPorProduto(esquina);
    if (ehDadoAusente(r)) return;
    expect(r.valor.por_produto.every((p) => doEsquina.has(p.produto_id))).toBe(true);
    expect(r.valor.por_produto.length).toBe(doEsquina.size);
  });
});
