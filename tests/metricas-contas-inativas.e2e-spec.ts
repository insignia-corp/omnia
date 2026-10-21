import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { MetricasService } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente } from "../src/metricas/resultado-metrica";

/**
 * Conta desconectada (revogada, expirada ou com erro) não apaga o que já foi importado: o extrato
 * dela continua valendo nos gastos, no saldo e no intervalo de extrato dos dias que cobre.
 */

const DIA = "2026-10-10";
const DIA_SO_DA_REVOGADA = "2026-10-12";

describe("métricas e contas desconectadas (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const repositorio = new RepositorioMetricasPostgres(db);
  const servico = new MetricasService(repositorio);

  let comercianteId: string;
  let outroId: string;
  let contaAtivaId: string;
  let contaRevogadaId: string;

  async function novaConta(
    dono: string,
    status: "ativo" | "revogado" | "expirado" | "erro",
    saldoInicialCentavos: number,
  ) {
    const [c] = await db
      .insert(schema.conta)
      .values({
        comercianteId: dono,
        instituicao: "Banco de teste",
        status,
        saldoInicialCentavos,
        saldoInicialEm: "2026-10-01",
      })
      .returning({ id: schema.conta.id });
    if (!c) throw new Error("conta não criada");
    return c.id;
  }

  async function novaTransacao(
    dono: string,
    contaId: string,
    data: string,
    tipo: "entrada" | "saida",
    valorCentavos: number,
  ) {
    await db.insert(schema.transacao).values({
      comercianteId: dono,
      contaId,
      data,
      tipo,
      valorCentavos,
      descricao: "teste",
      categoria: tipo === "saida" ? "despesa_operacional" : "vendas",
    });
  }

  beforeAll(async () => {
    await migrar(url);
    const criados = await db
      .insert(schema.comerciante)
      .values([{ nome: "Teste contas inativas A" }, { nome: "Teste contas inativas B" }])
      .returning({ id: schema.comerciante.id });
    comercianteId = criados[0]!.id;
    outroId = criados[1]!.id;

    await db.insert(schema.venda).values({
      comercianteId,
      data: DIA,
      numeroCupom: "cupom-1",
      totalCentavos: 100_000,
      origem: "planilha",
    });

    const ativa = await novaConta(comercianteId, "ativo", 1_000_000);
    const revogada = await novaConta(comercianteId, "revogado", 500_000);
    contaAtivaId = ativa;
    contaRevogadaId = revogada;
    await novaTransacao(comercianteId, ativa, DIA, "saida", 30_000);
    await novaTransacao(comercianteId, revogada, DIA, "saida", 20_000);
    await novaTransacao(comercianteId, revogada, DIA, "entrada", 10_000);
    await novaTransacao(comercianteId, revogada, DIA_SO_DA_REVOGADA, "saida", 5000);

    // Outro lojista com conta revogada e movimento no mesmo dia: não pode entrar nas contas do primeiro.
    const contaDoOutro = await novaConta(outroId, "revogado", 9_000_000);
    await novaTransacao(outroId, contaDoOutro, DIA, "saida", 999_999);
  });

  afterAll(async () => {
    for (const id of [comercianteId, outroId]) {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, id));
    }
    await pool.end();
  });

  it("o resumo do dia soma gastos e saldo das contas ativa e revogada", async () => {
    const r = await servico.resumoDiario({ comercianteId, dataReferencia: DIA }, DIA);
    if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio ausente: ${r.codigo}`);
    expect(r.valor.gastos_centavos).toBe(50_000);
    expect(r.valor.saldo_do_dia_centavos).toBe(50_000);
    expect(r.valor.saldo_da_conta).toEqual({
      saldo_centavos: 1_000_000 - 30_000 + (500_000 - 20_000 + 10_000),
    });
  });

  it("o intervalo de extrato é por conta e inclui a conta revogada", async () => {
    const intervalos = await repositorio.intervalosDeMovimentosPorConta(comercianteId);
    expect(intervalos).toHaveLength(2);
    expect(intervalos).toEqual(
      expect.arrayContaining([
        { contaId: contaAtivaId, primeira: DIA, ultima: DIA },
        { contaId: contaRevogadaId, primeira: DIA, ultima: DIA_SO_DA_REVOGADA },
      ]),
    );
  });

  it("os movimentos do dia trazem as duas contas, e só as deste comerciante", async () => {
    const movimentos = await repositorio.movimentosPorDia(comercianteId, DIA, DIA);
    const saidas = movimentos.filter((m) => m.tipo === "saida").reduce((s, m) => s + m.totalCentavos, 0);
    expect(new Set(movimentos.map((m) => m.contaId)).size).toBe(2);
    expect(saidas).toBe(50_000);
  });

  it("a lista de contas do comerciante tem as duas e nenhuma de outro lojista", async () => {
    const contas = await repositorio.contas(comercianteId);
    expect(contas.map((c) => c.saldoInicialCentavos ?? 0).sort((a, b) => a - b)).toEqual([
      500_000, 1_000_000,
    ]);
  });
});
