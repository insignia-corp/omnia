import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { registrarSincronizacaoDaConta } from "../src/ingestao/extrato/registrar-sincronizacao";
import { intervaloDeDatas } from "../src/lib/datas/datas";
import { MetricasService } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente } from "../src/metricas/resultado-metrica";

/**
 * Extrato por data de sincronização (#166): a conta ativa parada, mas sincronizada, não deixa o dia
 * sem total; a que nunca foi sincronizada continua bloqueando. A data só avança, e só para a conta
 * do comerciante da sessão.
 */

const INICIO = "2026-09-01";
const DIA = "2026-10-19";
const ULTIMA_TRANSACAO_DA_PARADA = "2026-10-05";
const GASTO_DIARIO = 1000;

describe("extrato por data de sincronização (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const servico = new MetricasService(new RepositorioMetricasPostgres(db));

  let comercianteId: string;
  let outroId: string;
  let contaPrincipal: string;
  let contaParada: string;
  let contaDoOutro: string;

  async function novoComerciante(nome: string): Promise<string> {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning({ id: schema.comerciante.id });
    if (!c) throw new Error("comerciante não criado");
    return c.id;
  }

  async function novaConta(dono: string): Promise<string> {
    const [c] = await db
      .insert(schema.conta)
      .values({
        comercianteId: dono,
        instituicao: "Banco de teste",
        status: "ativo",
        saldoInicialCentavos: 1_000_000,
        saldoInicialEm: INICIO,
      })
      .returning({ id: schema.conta.id });
    if (!c) throw new Error("conta não criada");
    return c.id;
  }

  const gastos = (dono: string, contaId: string, ate: string) =>
    intervaloDeDatas(INICIO, ate).map((data) => ({
      comercianteId: dono,
      contaId,
      data,
      tipo: "saida" as const,
      valorCentavos: GASTO_DIARIO,
      descricao: "despesa de teste",
      categoria: "despesa_operacional",
    }));

  const sincronizadaEm = async (contaId: string) =>
    (
      await db
        .select({ em: schema.conta.ultimaSincronizacaoEm })
        .from(schema.conta)
        .where(eq(schema.conta.id, contaId))
    )[0]?.em;

  beforeAll(async () => {
    await migrar(url);
    comercianteId = await novoComerciante("Teste sincronização A");
    outroId = await novoComerciante("Teste sincronização B");
    await db.insert(schema.venda).values({
      comercianteId,
      data: DIA,
      numeroCupom: "cupom-1",
      totalCentavos: 100_000,
      origem: "planilha",
    });
    contaPrincipal = await novaConta(comercianteId);
    contaParada = await novaConta(comercianteId);
    contaDoOutro = await novaConta(outroId);
    await db.insert(schema.transacao).values(gastos(comercianteId, contaPrincipal, DIA));
    await db.insert(schema.transacao).values(gastos(comercianteId, contaParada, ULTIMA_TRANSACAO_DA_PARADA));
  });

  afterAll(async () => {
    for (const id of [comercianteId, outroId]) {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, id));
    }
    await pool.end();
  });

  const resumoDoDia = async () => servico.resumoDiario({ comercianteId, dataReferencia: DIA }, DIA);

  it("conta ativa parada e nunca sincronizada deixa o dia sem total de gastos", async () => {
    const r = await resumoDoDia();
    if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio ausente: ${r.codigo}`);
    expect(r.valor.gastos_centavos).toMatchObject({ ausente: true, codigo: "dia_sem_extrato" });
    expect(r.valor.saldo_da_conta).toMatchObject({ ausente: true, codigo: "dia_sem_extrato" });
  });

  it("depois de sincronizar a conta parada, o dia tem total e o gasto fora do padrão volta", async () => {
    expect(
      await registrarSincronizacaoDaConta(db, { comercianteId, contaId: contaParada, data: DIA, hoje: DIA }),
    ).toBe(true);
    const r = await resumoDoDia();
    if (ehDadoAusente(r)) throw new Error(`Esperava resumo, veio ausente: ${r.codigo}`);
    expect(r.valor.gastos_centavos).toBe(GASTO_DIARIO); // só a conta principal gastou no dia
    expect(r.valor.saldo_do_dia_centavos).toBe(100_000 - GASTO_DIARIO);
    expect(r.valor.saldo_da_conta).not.toHaveProperty("ausente");
    const gasto = await servico.gastoForaDoPadrao({ comercianteId, dataReferencia: DIA }, DIA);
    expect(ehDadoAusente(gasto)).toBe(false);
  });

  it("a data de sincronização só avança", async () => {
    await registrarSincronizacaoDaConta(db, {
      comercianteId,
      contaId: contaParada,
      data: "2026-10-10",
      hoje: DIA,
    });
    expect(await sincronizadaEm(contaParada)).toBe(DIA);
    await registrarSincronizacaoDaConta(db, {
      comercianteId,
      contaId: contaParada,
      data: "2026-10-20",
      hoje: "2026-10-20",
    });
    expect(await sincronizadaEm(contaParada)).toBe("2026-10-20");
  });

  it("recusa sincronização com data depois de hoje, sem alterar a conta", async () => {
    const antes = await sincronizadaEm(contaParada);
    await expect(
      registrarSincronizacaoDaConta(db, {
        comercianteId,
        contaId: contaParada,
        data: "2026-12-31",
        hoje: DIA,
      }),
    ).rejects.toThrow(/futuro/);
    expect(await sincronizadaEm(contaParada)).toBe(antes);
  });

  it("conta revogada não recebe sincronização", async () => {
    const [c] = await db
      .insert(schema.conta)
      .values({ comercianteId, instituicao: "Banco antigo", status: "revogado" })
      .returning({ id: schema.conta.id });
    if (!c) throw new Error("conta não criada");
    expect(
      await registrarSincronizacaoDaConta(db, { comercianteId, contaId: c.id, data: DIA, hoje: DIA }),
    ).toBe(false);
    expect(await sincronizadaEm(c.id)).toBeNull();
  });

  it("não registra sincronização de conta de outro comerciante nem de data impossível", async () => {
    expect(
      await registrarSincronizacaoDaConta(db, { comercianteId, contaId: contaDoOutro, data: DIA, hoje: DIA }),
    ).toBe(false);
    expect(await sincronizadaEm(contaDoOutro)).toBeNull();
    await expect(
      registrarSincronizacaoDaConta(db, {
        comercianteId,
        contaId: contaParada,
        data: "2026-02-30",
        hoje: DIA,
      }),
    ).rejects.toThrow(/Data inexistente/);
    await expect(
      registrarSincronizacaoDaConta(db, { comercianteId, contaId: contaParada, data: DIA, hoje: "ontem" }),
    ).rejects.toThrow(/Data inválida/);
  });
});
