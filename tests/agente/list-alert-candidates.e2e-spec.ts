import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { montarCatalogo } from "../../src/agente/ferramentas/catalogo";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import type { CandidatosDoDia } from "../../src/agente/ferramentas/plano-a/list-alert-candidates";
import { RegistroFerramentas } from "../../src/agente/ferramentas/registro-ferramentas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { NumerosAutorizados, verificarNumeros } from "../../src/lib/verificador-numeros/verificador-numeros";

/**
 * `list_alert_candidates` (issue #52) pelo registro, como o agente a chama, contra o seed e o
 * gabarito dos alertas (fixtures/gabarito/metricas.json).
 */

interface AlertaGabarito {
  tipo: string;
  produto_id: string | null;
  fornecedor_id?: string;
  metricas: Record<string, number | string>;
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as {
  parametros: { data_referencia: string };
  fornecedores: Array<{ id: string; nome: string }>;
  alertas_esperados: AlertaGabarito[];
};
const REF = gabarito.parametros.data_referencia;

describe("list_alert_candidates contra o gabarito (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const registro = new RegistroFerramentas(montarCatalogo({ db }));

  let vilaNova: ContextoSessao;
  let esquina: ContextoSessao;
  const skuPorProduto = new Map<string, string>();
  const fornecedorDoGabarito = new Map<string, string>();

  const chaveDoGabarito = (tipo: string, produto: string | null | undefined, fornecedor?: string): string =>
    [tipo, produto ?? REF, fornecedor ?? ""].join("|");
  const chaveDoCandidato = (c: { tipo: string; produto_id: string | null; fornecedor_id: string | null }) =>
    chaveDoGabarito(
      c.tipo,
      c.produto_id ? skuPorProduto.get(c.produto_id) : null,
      c.fornecedor_id ? fornecedorDoGabarito.get(c.fornecedor_id) : undefined,
    );

  const listar = async (contexto: ContextoSessao): Promise<CandidatosDoDia> => {
    const r = await registro.executar(contexto, "list_alert_candidates", {});
    if (!r.ok) throw new Error(r.erro);
    return r.saida as CandidatosDoDia;
  };
  const linhasDoBanco = (comercianteId: string) =>
    db.select().from(schema.alerta).where(eq(schema.alerta.comercianteId, comercianteId));

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
    const fornecedores = await db
      .select({ id: schema.fornecedor.id, nome: schema.fornecedor.nome })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.comercianteId, vilaNova.comercianteId));
    for (const f of gabarito.fornecedores) {
      const linha = fornecedores.find((x) => x.nome === f.nome);
      if (linha) fornecedorDoGabarito.set(linha.id, f.id);
    }
  });

  afterAll(() => pool.end());

  it("o catálogo registra a ferramenta, e ela entra no registro sem comerciante_id no esquema", () => {
    expect(registro.nomes).toContain("list_alert_candidates");
  });

  it("devolve os 16 candidatos do gabarito, com os números nas métricas de apoio", async () => {
    const saida = await listar(vilaNova);
    const esperados = gabarito.alertas_esperados.map((a) =>
      chaveDoGabarito(a.tipo, a.produto_id, a.fornecedor_id),
    );
    expect(esperados).toHaveLength(16);
    expect(saida.candidatos.map(chaveDoCandidato).sort()).toEqual([...esperados].sort());
    expect(saida.n_registros).toBe(16);
    expect(saida.data).toBe(REF);
    for (const esperado of gabarito.alertas_esperados) {
      const chave = chaveDoGabarito(esperado.tipo, esperado.produto_id, esperado.fornecedor_id);
      const candidato = saida.candidatos.find((c) => chaveDoCandidato(c) === chave);
      expect(candidato?.metricas_apoio).toMatchObject(esperado.metricas);
    }
  });

  it("vem do mais ao menos importante (prioridade 1 a 3, sem voltar atrás)", async () => {
    const prioridades = (await listar(vilaNova)).candidatos.map((c) => c.prioridade);
    expect(prioridades).toEqual([...prioridades].sort((a, b) => a - b));
    expect(prioridades.every((p) => [1, 2, 3].includes(p))).toBe(true);
  });

  it("é idempotente: repetir no mesmo dia devolve os mesmos ids e não cria linhas", async () => {
    const antes = await listar(vilaNova);
    const depois = await listar(vilaNova);
    expect(depois.candidatos.map((c) => c.alerta_id)).toEqual(antes.candidatos.map((c) => c.alerta_id));
    expect(await linhasDoBanco(vilaNova.comercianteId)).toHaveLength(16);
  });

  it("os ids devolvidos servem ao select_alerts do mesmo comerciante, e não ao de outro", async () => {
    const [a, b, c] = (await listar(vilaNova)).candidatos;
    const escolha = {
      alertas: [a, b, c].map((x) => ({ alerta_id: x!.alerta_id, justificativa: "maior impacto" })),
    };
    expect((await registro.executar(vilaNova, "select_alerts", escolha)).ok).toBe(true);
    expect((await registro.executar(esquina, "select_alerts", escolha)).ok).toBe(false);
  });

  it("isolamento: a Esquina não recebe candidato do Vila Nova, e os ausentes dela dizem o motivo", async () => {
    const doVila = new Set((await listar(vilaNova)).candidatos.map((c) => c.alerta_id));
    const saida = await listar(esquina);
    expect(saida.candidatos.some((c) => doVila.has(c.alerta_id))).toBe(false);
    const doBanco = await linhasDoBanco(esquina.comercianteId);
    expect(saida.candidatos.map((c) => c.alerta_id).sort()).toEqual(doBanco.map((l) => l.id).sort());
    expect(saida.n_registros).toBe(saida.candidatos.length);
    expect(saida.ausentes.some((a) => a.codigo === "historico_insuficiente")).toBe(true);
  });

  it("regra 8: o impacto de um candidato autoriza o valor em reais, e os ids não autorizam números", async () => {
    const saida = await listar(vilaNova);
    const comImpacto = saida.candidatos.find((c) => typeof c.metricas_apoio.impacto_centavos === "number")!;
    const impacto = comImpacto.metricas_apoio.impacto_centavos as number;
    const reais = (impacto / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
    const autorizados = new NumerosAutorizados([saida]);
    expect(verificarNumeros(`O impacto é de R$ ${reais} por semana.`, autorizados).aprovado).toBe(true);
    expect(verificarNumeros(`O impacto é de R$ ${reais}1 por semana.`, autorizados).aprovado).toBe(false);
  });
});
