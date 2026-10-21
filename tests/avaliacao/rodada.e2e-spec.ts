import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { casosDeExemplo } from "../../src/avaliacao/casos/exemplos";
import { chamar, texto } from "../../src/avaliacao/modelo-roteirizado";
import { gravarRodada } from "../../src/avaliacao/relatorio";
import { ErroAvaliacao, rodarAvaliacao } from "../../src/avaliacao/rodada";
import type { CasoAvaliacao } from "../../src/avaliacao/tipos";
import { carregarEnv, type Env } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";

/** Caso em que o modelo inventa o número: o verificador barra e a versão corrigida segue. */
const casoDoVerificador: CasoAvaliacao = {
  id: "verificador-1",
  categoria: "verificador",
  descricao: "Modelo inventa o faturamento; o verificador barra e a correção sai",
  gatilho: "mensagem_dono",
  entrada: "Quanto vendi ontem?",
  ferramentasEsperadas: [],
  criterio: { tipo: "bloqueio_verificador", minBloqueios: 1, resultadoFinal: "aprovada" },
  roteiro: [texto("Ontem você vendeu R$ 9.999,99."), texto("Não tenho esse dado agora.")],
};

/** Caso que reprova de propósito: a ferramenta esperada não é chamada. */
const casoQueFalha: CasoAvaliacao = {
  id: "falha-1",
  categoria: "numerica",
  descricao: "Reprova: não chama a ferramenta",
  gatilho: "mensagem_dono",
  entrada: "Quanto vendi ontem?",
  ferramentasEsperadas: ["get_daily_summary"],
  criterio: {
    tipo: "numero_correto",
    numeros: [{ rotulo: "faturamento", valor: 122151, unidade: "centavos" }],
  },
  roteiro: [chamar("ferramenta_inexistente", {}, "t1"), texto("Não sei.")],
};

describe("rodada de avaliação com banco real (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  let comercianteId = "";
  let pasta = "";

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    const [dono] = await db.insert(schema.comerciante).values({ nome: "E2E Avaliação" }).returning();
    comercianteId = dono!.id;
    pasta = mkdtempSync(path.join(tmpdir(), "omnia-eval-e2e-"));
    jest.spyOn(Logger.prototype, "warn").mockImplementation();
    jest.spyOn(Logger.prototype, "error").mockImplementation();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, comercianteId));
    await pool.end();
    rmSync(pasta, { recursive: true, force: true });
  });

  it("modo falso: roda os casos, registra as execuções e gera o relatório versionado", async () => {
    const rodada = await rodarAvaliacao({
      db,
      env,
      modo: "falso",
      comercianteId,
      catalogoDeCasos: [...casosDeExemplo(), casoDoVerificador, casoQueFalha],
    });

    expect(rodada).toMatchObject({ modo: "falso", versaoPrompt: "sistema-v2", comerciante: "E2E Avaliação" });
    expect(rodada.resultados.map((r) => [r.id, r.aprovado])).toEqual([
      ["q01", true],
      ["q33", true],
      ["verificador-1", true],
      ["falha-1", false],
    ]);
    const falha = rodada.resultados.find((r) => r.id === "falha-1");
    expect(falha?.motivos.join(" ")).toContain("Ferramenta esperada não chamada: get_daily_summary");
    expect(rodada.resultados.find((r) => r.id === "verificador-1")?.bloqueios).toBe(1);

    // Cada execução ficou registrada no banco, com versão do prompt e latência.
    const linhas = await db
      .select()
      .from(schema.execucaoAgente)
      .where(eq(schema.execucaoAgente.comercianteId, comercianteId));
    expect(linhas).toHaveLength(4);
    for (const l of linhas)
      expect(l).toMatchObject({ versaoPrompt: "sistema-v2", modelo: "falso-roteirizado" });
    const q01 = rodada.resultados.find((r) => r.id === "q01");
    expect(linhas.find((l) => l.id === q01?.execucaoId)?.latenciaMs).toBe(q01?.latenciaMs);

    const arquivos = gravarRodada(rodada, {
      relatorios: path.join(pasta, "docs/avaliacoes"),
      evidencias: path.join(pasta, "evidencias"),
    });
    const md = readFileSync(arquivos.relatorio, "utf8");
    expect(md).toContain("**3 de 4 casos passaram (75%).**");
    expect(md).toContain("### falha-1 (numerica)");
  });

  it("filtra por caso e recusa id inexistente", async () => {
    const so = await rodarAvaliacao({ db, env, modo: "falso", comercianteId, casos: ["q33"] });
    expect(so.resultados.map((r) => r.id)).toEqual(["q33"]);
    await expect(rodarAvaliacao({ db, env, modo: "falso", comercianteId, casos: ["q99"] })).rejects.toThrow(
      "Caso inexistente: q99",
    );
  });

  it("recusa data de referência impossível e caso com número ambíguo, antes de rodar", async () => {
    await expect(
      rodarAvaliacao({ db, env, modo: "falso", comercianteId, dataReferencia: "2026-02-30" }),
    ).rejects.toThrow(/2026-02-30.*não é uma data/);
    const ambiguo: CasoAvaliacao = {
      ...casoQueFalha,
      id: "ambiguo-1",
      criterio: {
        tipo: "numero_correto",
        numeros: [
          { rotulo: "a", valor: 1, unidade: "centavos" },
          { rotulo: "b", valor: 2, unidade: "centavos" },
        ],
      },
    };
    await expect(
      rodarAvaliacao({ db, env, modo: "falso", comercianteId, catalogoDeCasos: [ambiguo] }),
    ).rejects.toThrow(/ambiguo-1: Critério ambíguo/);
  });

  it("modo real sem ANTHROPIC_API_KEY falha com mensagem clara, antes de tocar no banco", async () => {
    const semChave: Env = { ...env };
    delete semChave.ANTHROPIC_API_KEY;
    const tentativa = rodarAvaliacao({ db, env: semChave, modo: "real", comercianteId });
    await expect(tentativa).rejects.toBeInstanceOf(ErroAvaliacao);
    await expect(tentativa).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("comerciante inexistente falha com mensagem clara", async () => {
    await expect(rodarAvaliacao({ db, env, modo: "falso", comercianteId: randomUUID() })).rejects.toThrow(
      /não existe no banco/,
    );
  });
});
