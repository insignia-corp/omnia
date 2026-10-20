import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { RegistroExecucoesPostgres } from "../src/agente/execucao/registro-execucoes";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";

describe("RegistroExecucoesPostgres (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });

  beforeAll(() => migrar(url));
  afterAll(() => pool.end());

  it("grava a execução e as chamadas de ferramenta em ordem", async () => {
    const [loja] = await db.insert(schema.comerciante).values({ nome: "Mercadinho de Teste" }).returning();
    const id = await new RegistroExecucoesPostgres(db).salvar({
      comercianteId: loja!.id,
      gatilho: "mensagem_dono",
      entrada: "Qual a margem do arroz?",
      modelo: "claude-opus-5-5",
      versaoPrompt: "sistema-v1",
      resultado: "aprovada",
      mensagemFinal: "A margem do arroz é de 18,2%.",
      iteracoes: 2,
      bloqueios: [{ tentativa: 1, numeros: ["20%"] }],
      tokensEntrada: 2000,
      tokensSaida: 150,
      tokensCacheLeitura: 0,
      custoEstimadoMicrodolares: 11000,
      latenciaMs: 1800,
      erro: null,
      chamadas: [
        {
          ordem: 1,
          ferramenta: "get_product_margin",
          entrada: { produto: "Arroz 5kg" },
          saida: { valor: { margem_percentual: 18.2 } },
          erro: null,
          menorConfianca: 0.95,
          latenciaMs: 12,
        },
        {
          ordem: 2,
          ferramenta: "get_cost_changes",
          entrada: {},
          saida: null,
          erro: "Falha ao executar",
          menorConfianca: null,
          latenciaMs: 3,
        },
      ],
    });

    const exec = await db.query.execucaoAgente.findFirst({ where: eq(schema.execucaoAgente.id, id) });
    expect(exec).toMatchObject({
      bloqueiosVerificador: 1,
      detalhesVerificador: [{ tentativa: 1, numeros: ["20%"] }],
    });
    const chamadas = await db
      .select()
      .from(schema.chamadaFerramenta)
      .where(eq(schema.chamadaFerramenta.execucaoId, id))
      .orderBy(asc(schema.chamadaFerramenta.ordem));
    expect(chamadas.map((c) => [c.ferramenta, c.comercianteId])).toEqual([
      ["get_product_margin", loja!.id],
      ["get_cost_changes", loja!.id],
    ]);

    // Exclusão do comerciante apaga tudo dele (base da exclusão a pedido, LGPD).
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, loja!.id));
    expect(
      await db.query.execucaoAgente.findFirst({ where: eq(schema.execucaoAgente.id, id) }),
    ).toBeUndefined();
  });
});
