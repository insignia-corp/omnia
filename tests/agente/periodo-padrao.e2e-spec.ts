import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { montarCatalogo } from "../../src/agente/ferramentas/catalogo";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import { RegistroFerramentas } from "../../src/agente/ferramentas/registro-ferramentas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { somarDias } from "../../src/lib/datas/datas";

/**
 * Período padrão das ferramentas do agente (avaliação real de 23/10): o dia da execução ainda não tem
 * vendas completas, então as janelas terminam ontem. Com a execução em 20/10 e vendas até 19/10, a
 * semana, o mês e os rankings têm dados, e os números são os do gabarito.
 */
interface Gabarito {
  parametros: { data_referencia: string };
  serie_diaria: Array<{ data: string; faturamento_centavos: number; cupons: number }>;
  giro: {
    maior_alta: Array<{ produto_id: string; alta_bps: number | null }>;
    maior_volume: Array<{ produto_id: string; unidades_7_dias: number }>;
  };
  receita_por_produto: { maior_receita: Array<{ produto_id: string; receita_centavos: number }> };
}
const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;
const ULTIMO_DIA_COM_VENDAS = gabarito.parametros.data_referencia;
const DIA_DA_EXECUCAO = somarDias(ULTIMO_DIA_COM_VENDAS, 1);

interface Saida {
  ausente?: true;
  codigo?: string;
  periodo?: { inicio: string; fim: string };
  valor: Record<string, unknown>;
}

describe("período padrão das ferramentas do agente (e2e)", () => {
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
  const somaDaSerie = (inicio: string, fim: string) =>
    gabarito.serie_diaria
      .filter((d) => d.data >= inicio && d.data <= fim)
      .reduce(
        (t, d) => ({ faturamento: t.faturamento + d.faturamento_centavos, cupons: t.cupons + d.cupons }),
        {
          faturamento: 0,
          cupons: 0,
        },
      );

  beforeAll(async () => {
    await migrar(url);
    const resumo = await semear(db);
    const contextoDe = (nome: string): ContextoSessao => {
      const linha = resumo.find((r) => r.comerciante === nome);
      if (!linha) throw new Error(`Comerciante ${nome} não está no seed`);
      return { comercianteId: linha.comercianteId, nomeComercio: nome, dataReferencia: DIA_DA_EXECUCAO };
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

  it("get_period_summary semana termina ontem e traz os números do gabarito, não erro de cobertura", async () => {
    const saida = await chamar(vilaNova, "get_period_summary", { periodo: "semana" });
    expect(saida.ausente).toBeUndefined();
    expect(saida.valor).toMatchObject({
      tipo: "semana",
      inicio: somarDias(ULTIMO_DIA_COM_VENDAS, -6),
      fim: ULTIMO_DIA_COM_VENDAS,
    });
    const esperado = somaDaSerie(somarDias(ULTIMO_DIA_COM_VENDAS, -6), ULTIMO_DIA_COM_VENDAS);
    expect(saida.valor).toMatchObject({
      faturamento_centavos: esperado.faturamento,
      cupons: esperado.cupons,
    });
  });

  it("get_period_summary mes vai do dia 1 até ontem, com o faturamento do gabarito", async () => {
    const saida = await chamar(vilaNova, "get_period_summary", { periodo: "mes" });
    expect(saida.ausente).toBeUndefined();
    expect(saida.valor).toMatchObject({
      tipo: "mes",
      inicio: `${ULTIMO_DIA_COM_VENDAS.slice(0, 8)}01`,
      fim: ULTIMO_DIA_COM_VENDAS,
    });
    const esperado = somaDaSerie(`${ULTIMO_DIA_COM_VENDAS.slice(0, 8)}01`, ULTIMO_DIA_COM_VENDAS);
    expect(saida.valor).toMatchObject({
      faturamento_centavos: esperado.faturamento,
      cupons: esperado.cupons,
    });
  });

  it("o `ate` explícito continua valendo: pedir o dia da execução devolve dado ausente, não zero", async () => {
    const saida = await chamar(vilaNova, "get_period_summary", { periodo: "semana", ate: DIA_DA_EXECUCAO });
    expect(saida.ausente).toBe(true);
  });

  it("get_top_products volume e alta devolvem dados do gabarito, com a janela até ontem", async () => {
    const volume = await chamar(vilaNova, "get_top_products", { criterio: "volume" });
    expect(volume.ausente).toBeUndefined();
    expect(volume.periodo?.fim).toBe(ULTIMO_DIA_COM_VENDAS);
    const produtosVolume = volume.valor.produtos as Array<{ produto_id: string; unidades_7_dias: number }>;
    expect(produtosVolume.map((p) => [skuPorProduto.get(p.produto_id), p.unidades_7_dias])).toEqual(
      gabarito.giro.maior_volume.map((p) => [p.produto_id, p.unidades_7_dias]),
    );
    const alta = await chamar(vilaNova, "get_top_products", { criterio: "alta" });
    expect(alta.ausente).toBeUndefined();
    const produtosAlta = alta.valor.produtos as Array<{ produto_id: string; alta_bps: number | null }>;
    expect(produtosAlta.map((p) => [skuPorProduto.get(p.produto_id), p.alta_bps])).toEqual(
      gabarito.giro.maior_alta.map((p) => [p.produto_id, p.alta_bps]),
    );
  });

  it("get_top_products receita devolve o ranking do gabarito", async () => {
    const receita = await chamar(vilaNova, "get_top_products", { criterio: "receita" });
    expect(receita.ausente).toBeUndefined();
    expect(receita.periodo?.fim).toBe(ULTIMO_DIA_COM_VENDAS);
    const produtos = receita.valor.produtos as Array<{ produto_id: string; receita_centavos: number }>;
    expect(produtos.map((p) => [skuPorProduto.get(p.produto_id), p.receita_centavos])).toEqual(
      gabarito.receita_por_produto.maior_receita.map((p) => [p.produto_id, p.receita_centavos]),
    );
  });

  it("isolamento: nenhum produto do Vila Nova aparece nas respostas do outro comerciante", async () => {
    const respostas = [
      await chamar(esquina, "get_period_summary", { periodo: "semana" }),
      ...(await Promise.all(
        (["volume", "alta", "receita"] as const).map((criterio) =>
          chamar(esquina, "get_top_products", { criterio }),
        ),
      )),
    ];
    const texto = JSON.stringify(respostas);
    for (const id of skuPorProduto.keys()) expect(texto).not.toContain(id);
    // E os números do Vila Nova não vazam: o faturamento da semana do outro é o dele.
    const semanaVila = await chamar(vilaNova, "get_period_summary", { periodo: "semana" });
    expect(JSON.stringify(respostas[0])).not.toEqual(JSON.stringify(semanaVila));
  });
});
