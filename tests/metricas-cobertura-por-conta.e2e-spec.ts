import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { intervaloDeDatas } from "../src/lib/datas/datas";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { MetricasService } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente } from "../src/metricas/resultado-metrica";

/**
 * Extrato por conta (#143): o extrato em dia de uma conta não esconde o atraso da outra. Dia que
 * uma conta ativa não cobre não ganha total de gastos, e o gasto fora do padrão também some.
 */

const INICIO = "2026-09-01";
const PRIMEIRO_EXTRATO_DA_CONTA_B = "2026-09-10";
const FIM_DA_CONTA_A = "2026-10-18";
const DIA_SO_DA_CONTA_B = "2026-10-19";
const GASTO_DIARIO = 1000;

describe("métricas e extrato por conta (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const servico = new MetricasService(new RepositorioMetricasPostgres(db));

  let comercianteId: string;

  async function novaConta(saldoInicialEm: string): Promise<string> {
    const [c] = await db
      .insert(schema.conta)
      .values({
        comercianteId,
        instituicao: "Banco de teste",
        status: "ativo",
        saldoInicialCentavos: 1_000_000,
        saldoInicialEm,
      })
      .returning({ id: schema.conta.id });
    if (!c) throw new Error("conta não criada");
    return c.id;
  }

  const gastosDiarios = (contaId: string, de: string, ate: string) =>
    intervaloDeDatas(de, ate).map((data) => ({
      comercianteId,
      contaId,
      data,
      tipo: "saida" as const,
      valorCentavos: GASTO_DIARIO,
      descricao: "despesa operacional de teste",
      categoria: "despesa_operacional",
    }));

  beforeAll(async () => {
    await migrar(url);
    const [c] = await db
      .insert(schema.comerciante)
      .values({ nome: "Teste cobertura por conta" })
      .returning({ id: schema.comerciante.id });
    if (!c) throw new Error("comerciante não criado");
    comercianteId = c.id;

    await db.insert(schema.venda).values(
      ["2026-09-05", FIM_DA_CONTA_A, DIA_SO_DA_CONTA_B].map((data) => ({
        comercianteId,
        data,
        numeroCupom: `cupom-${data}`,
        totalCentavos: 100_000,
        origem: "planilha" as const,
      })),
    );
    const contaA = await novaConta(INICIO);
    const contaB = await novaConta(INICIO); // aberta cedo, mas o extrato só foi importado a partir de 10/09
    await db.insert(schema.transacao).values(gastosDiarios(contaA, INICIO, FIM_DA_CONTA_A));
    await db
      .insert(schema.transacao)
      .values(gastosDiarios(contaB, PRIMEIRO_EXTRATO_DA_CONTA_B, DIA_SO_DA_CONTA_B));
  });

  afterAll(async () => {
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, comercianteId));
    await pool.end();
  });

  const contexto = (dia: string) => ({ comercianteId, dataReferencia: dia });

  it("dia coberto pelas duas contas soma os gastos das duas", async () => {
    const r = await servico.resumoDiario(contexto(FIM_DA_CONTA_A), FIM_DA_CONTA_A);
    if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio ausente: ${r.codigo}`);
    expect(r.valor.gastos_centavos).toBe(2 * GASTO_DIARIO);
    expect(r.valor.saldo_do_dia_centavos).toBe(100_000 - 2 * GASTO_DIARIO);
  });

  it("dia que só uma conta cobre não publica total de gastos nem saldo, mesmo com extrato da outra", async () => {
    const r = await servico.resumoDiario(contexto(DIA_SO_DA_CONTA_B), DIA_SO_DA_CONTA_B);
    if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio ausente: ${r.codigo}`);
    expect(r.valor.faturamento_centavos).toBe(100_000);
    const ausente = { ausente: true, codigo: "dia_sem_extrato" };
    expect(r.valor.gastos_centavos).toMatchObject(ausente);
    expect(r.valor.saldo_do_dia_centavos).toMatchObject(ausente);
    expect(r.valor.saldo_da_conta).toMatchObject(ausente);
  });

  it("dia anterior ao primeiro extrato da conta B: gastos, saldo do dia e saldo da conta ausentes", async () => {
    const r = await servico.resumoDiario(contexto("2026-09-05"), "2026-09-05");
    if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio ausente: ${r.codigo}`);
    const ausente = { ausente: true, codigo: "dia_sem_extrato" };
    expect(r.valor.gastos_centavos).toMatchObject(ausente);
    expect(r.valor.saldo_do_dia_centavos).toMatchObject(ausente);
    // Sem o extrato da conta B, o saldo somaria o saldo inicial dela e só os movimentos da A.
    expect(r.valor.saldo_da_conta).toMatchObject(ausente);
  });

  it("o gasto fora do padrão sai no dia coberto pelas duas contas e some no dia que só uma cobre", async () => {
    const coberto = await servico.gastoForaDoPadrao(contexto(FIM_DA_CONTA_A), FIM_DA_CONTA_A);
    if (ehDadoAusente(coberto)) throw new Error(`Esperava métrica, veio ausente: ${coberto.codigo}`);
    expect(coberto.valor.valor_centavos).toBe(2 * GASTO_DIARIO);
    expect(await servico.gastoForaDoPadrao(contexto(DIA_SO_DA_CONTA_B), DIA_SO_DA_CONTA_B)).toMatchObject({
      ausente: true,
      codigo: "dia_sem_dados",
    });
  });

  it("a janela de histórico começa no maior início de conta, e dia anterior a esse início fica ausente", async () => {
    const r = await servico.gastoForaDoPadrao(contexto(FIM_DA_CONTA_A), FIM_DA_CONTA_A);
    if (ehDadoAusente(r)) throw new Error(`Esperava métrica, veio ausente: ${r.codigo}`);
    // De 10/09 (primeiro extrato da conta B) até 17/10: 38 dias, nenhum só da conta A.
    expect(r.valor.dias_de_historico).toBe(38);
    expect(r.valor.mediana_centavos).toBe(2 * GASTO_DIARIO);
    // A conta A já tinha extrato em 05/09 e a B (aberta desde 01/09) ainda não: o dia não pode ter total.
    expect(await servico.gastoForaDoPadrao(contexto("2026-09-05"), "2026-09-05")).toMatchObject({
      ausente: true,
      codigo: "dia_sem_dados",
    });
  });
});
