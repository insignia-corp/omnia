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
import { NumerosAutorizados, verificarNumeros } from "../../src/lib/verificador-numeros/verificador-numeros";
import { centavos, formatarBRL } from "../../src/lib/dinheiro/dinheiro";
import type { BriefingDiario } from "../../src/metricas/briefing-diario";
import type { NumerosDoDia } from "../../src/metricas/dia-contra-mesmos-dias";
import type { ProdutoMaisVendido } from "../../src/metricas/movimento-de-produtos";

/**
 * `get_daily_briefing` pelo registro, como o agente a chama, contra o seed do Mercadinho Vila Nova.
 * Os números do dia e dos rankings são refeitos aqui direto no banco, sem as funções de métrica; os
 * produtos em atenção são conferidos contra o gabarito (fixtures/gabarito/metricas.json).
 */

interface Gabarito {
  parametros: { data_referencia: string };
  meta_margem_bps: number;
  margem_por_produto: Array<{ produto_id: string; situacao: string; margem_bps: number | null }>;
  variacao_de_custo: Array<{
    produto_id: string;
    custo_anterior_centavos: number;
    custo_atual_centavos: number;
    compra_atual: { data: string };
    variacao_bps: number;
    variacao_percentual: number;
    acima_do_limite: boolean;
  }>;
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;
/** O último dia com vendas no gabarito; a execução é a do dia seguinte, e a ferramenta resume ontem. */
const DIA = gabarito.parametros.data_referencia;
const DIA_DA_EXECUCAO = somarDias(DIA, 1);

describe("get_daily_briefing (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const registro = new RegistroFerramentas(montarCatalogo({ db }));

  let vilaNova: ContextoSessao;
  let briefing: BriefingDiario;
  const idPorSku = new Map<string, string>();

  /** Faturamento e cupons de um dia, direto da tabela de vendas. */
  async function vendasDoDia(data: string): Promise<{ faturamento: number; cupons: number }> {
    const { rows } = await pool.query<{ faturamento: string; cupons: string }>(
      "select coalesce(sum(total_centavos), 0) as faturamento, count(*) as cupons from venda where comerciante_id = $1 and data = $2",
      [vilaNova.comercianteId, data],
    );
    return { faturamento: Number(rows[0]?.faturamento), cupons: Number(rows[0]?.cupons) };
  }

  /** Unidades por produto entre duas datas, direto dos itens de venda. */
  async function unidades(
    desde: string,
    ate: string,
  ): Promise<Map<string, { nome: string; unidades: number }>> {
    const { rows } = await pool.query<{ produto_id: string; nome: string; unidades: string }>(
      `select i.produto_id, p.nome, sum(i.quantidade) as unidades
         from item_de_venda i
         join venda v on v.id = i.venda_id
         join produto p on p.id = i.produto_id
        where v.comerciante_id = $1 and v.data between $2 and $3
        group by i.produto_id, p.nome`,
      [vilaNova.comercianteId, desde, ate],
    );
    return new Map(rows.map((r) => [r.produto_id, { nome: r.nome, unidades: Number(r.unidades) }]));
  }

  beforeAll(async () => {
    await migrar(url);
    const resumo = await semear(db);
    const linha = resumo.find((r) => r.comerciante === "Mercadinho Vila Nova");
    if (!linha) throw new Error("Mercadinho Vila Nova não está no seed");
    vilaNova = {
      comercianteId: linha.comercianteId,
      nomeComercio: linha.comerciante,
      dataReferencia: DIA_DA_EXECUCAO,
    };
    const produtos = await db
      .select({ id: schema.produto.id, sku: schema.produto.sku })
      .from(schema.produto)
      .where(eq(schema.produto.comercianteId, vilaNova.comercianteId));
    for (const p of produtos) if (p.sku) idPorSku.set(p.sku, p.id);

    const r = await registro.executar(vilaNova, "get_daily_briefing", {});
    if (!r.ok) throw new Error(r.erro);
    briefing = r.saida as BriefingDiario;
  });

  afterAll(() => pool.end());

  it("sem data resume ontem, com a procedência", () => {
    expect(briefing.data).toBe(DIA);
    expect(briefing.periodo.fim).toBe(DIA);
    expect(briefing.n_registros).toBeGreaterThan(0);
    expect(briefing.menor_confianca).not.toBeNull();
    expect(briefing.origens.length).toBeGreaterThan(0);
  });

  it("o dia e a média dos mesmos dias das 3 semanas anteriores batem com a conta no banco", async () => {
    const datas = [7, 14, 21].map((d) => somarDias(DIA, -d));
    const dia = await vendasDoDia(DIA);
    const anteriores = await Promise.all(datas.map(vendasDoDia));
    const somaFaturamento = anteriores.reduce((s, d) => s + d.faturamento, 0);
    const somaCupons = anteriores.reduce((s, d) => s + d.cupons, 0);

    expect(briefing.dia).toEqual({
      faturamento_centavos: dia.faturamento,
      vendas: dia.cupons,
      ticket_medio_centavos: Math.round(dia.faturamento / dia.cupons),
    });
    expect(briefing.mesmos_dias_anteriores).toEqual({
      semanas: 3,
      datas,
      media_faturamento_centavos: Math.round(somaFaturamento / 3),
      media_vendas: Math.round(somaCupons / 3),
      media_ticket_medio_centavos: Math.round(somaFaturamento / somaCupons),
    });
    const percentual = (atual: number, base: number) => Math.round(((atual - base) / base) * 10_000) / 100;
    expect(briefing.variacao_faturamento_percentual).toBe(percentual(dia.faturamento, somaFaturamento / 3));
    expect(briefing.variacao_ticket_percentual).toBe(
      percentual(dia.faturamento / dia.cupons, somaFaturamento / somaCupons),
    );
  });

  it("mais vendidos e piores batem com as unidades no banco", async () => {
    const semana = await unidades(somarDias(DIA, -6), DIA);
    const anterior = await unidades(somarDias(DIA, -13), somarDias(DIA, -7));
    const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, "pt-BR");

    const esperadosMais = [...semana]
      .map(([id, s]) => ({ produto_id: id, nome: s.nome, unidades: s.unidades }))
      .sort((a, b) => b.unidades - a.unidades || porNome(a, b))
      .slice(0, 3)
      .map((p) => ({ produto_id: p.produto_id, produto: p.nome, unidades_7_dias: p.unidades }));
    expect(briefing.mais_vendidos).toEqual(esperadosMais);

    const esperadosPiores = [...anterior]
      .map(([id, a]) => ({
        produto_id: id,
        nome: a.nome,
        antes: a.unidades,
        agora: semana.get(id)?.unidades ?? 0,
      }))
      .filter((p) => p.antes >= 10 && p.agora < p.antes)
      .sort(
        (a, b) =>
          b.antes - b.agora - (a.antes - a.agora) || a.agora / a.antes - b.agora / b.antes || porNome(a, b),
      )
      .slice(0, 3)
      .map((p) => ({
        produto_id: p.produto_id,
        produto: p.nome,
        unidades_7_dias: p.agora,
        unidades_7_dias_anteriores: p.antes,
        variacao_percentual: Math.round(((p.agora - p.antes) / p.antes) * 10_000) / 100,
      }));
    expect(briefing.piores).toEqual(esperadosPiores);
  });

  it("os produtos em atenção seguem o gabarito: custo que subiu na semana, depois a menor margem abaixo da meta", () => {
    const inicioDaSemana = somarDias(DIA, -6);
    const custoSubiu = gabarito.variacao_de_custo
      .filter((v) => v.acima_do_limite && v.compra_atual.data >= inicioDaSemana && v.compra_atual.data <= DIA)
      .sort((a, b) => b.variacao_bps - a.variacao_bps)
      .map((v) => ({
        produto_id: idPorSku.get(v.produto_id),
        motivo: "custo_subiu",
        custo_anterior_centavos: v.custo_anterior_centavos,
        custo_atual_centavos: v.custo_atual_centavos,
        variacao_percentual: v.variacao_percentual,
        data_compra: v.compra_atual.data,
      }));
    const margemAbaixo = gabarito.margem_por_produto
      .filter((m) => m.situacao === "ok" && m.margem_bps !== null && m.margem_bps < gabarito.meta_margem_bps)
      .sort((a, b) => (a.margem_bps ?? 0) - (b.margem_bps ?? 0))
      .map((m) => ({
        produto_id: idPorSku.get(m.produto_id),
        motivo: "margem_abaixo_da_meta",
        margem_percentual: (m.margem_bps ?? 0) / 100,
        meta_percentual: gabarito.meta_margem_bps / 100,
      }));
    const vistos = new Set<string | undefined>();
    const esperados = [...custoSubiu, ...margemAbaixo]
      .filter((p) => !vistos.has(p.produto_id) && vistos.add(p.produto_id))
      .slice(0, 3);

    expect(esperados.length).toBe(3);
    expect(briefing.atencao).toEqual(esperados.map((e): unknown => expect.objectContaining(e)));
  });

  it("o verificador aceita a mensagem do resumo com esses números e barra um número inventado", () => {
    const dia = briefing.dia as NumerosDoDia;
    const media = briefing.mesmos_dias_anteriores as { media_faturamento_centavos: number };
    const [primeiro] = briefing.mais_vendidos as ProdutoMaisVendido[];
    const variacao = briefing.variacao_faturamento_percentual ?? 0;
    const mensagem =
      `Ontem você faturou ${formatarBRL(centavos(dia.faturamento_centavos))} em ${dia.vendas} vendas, ` +
      `ticket médio de ${formatarBRL(centavos(dia.ticket_medio_centavos))}. A média das últimas 3 segundas foi ` +
      `${formatarBRL(centavos(media.media_faturamento_centavos))} (${variacao < 0 ? "queda" : "alta"} de ` +
      `${String(Math.abs(variacao)).replace(".", ",")}%). Nos últimos 7 dias, o mais vendido foi ${primeiro?.produto}, ` +
      `com ${primeiro?.unidades_7_dias} unidades.`;
    const autorizados = new NumerosAutorizados([briefing]);
    expect(verificarNumeros(mensagem, autorizados)).toMatchObject({ aprovado: true });
    expect(verificarNumeros("Ontem você faturou R$ 9.999,99.", autorizados).aprovado).toBe(false);
  });

  it("um dia sem vendas importadas vem como dado ausente, nunca zero", async () => {
    const r = await registro.executar(vilaNova, "get_daily_briefing", { data: "2020-01-03" });
    if (!r.ok) throw new Error(r.erro);
    const saida = r.saida as BriefingDiario;
    expect(saida.dia).toMatchObject({ ausente: true, codigo: "dia_sem_dados" });
    expect(saida.mesmos_dias_anteriores).toMatchObject({ ausente: true });
    expect(saida.variacao_faturamento_percentual).toBeNull();
    expect(saida.mais_vendidos).toMatchObject({ ausente: true });
    expect(saida.piores).toMatchObject({ ausente: true });
  });
});
