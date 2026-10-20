import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import {
  RegistroExecucoesPostgres,
  type ExecucaoRegistrada,
  type RegistroExecucoes,
} from "../src/agente/execucao/registro-execucoes";
import { carregarEnv } from "../src/config/env";
import { ArmazenamentoDisco } from "../src/infra/armazenamento/armazenamento-disco";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import type { ExtracaoNota } from "../src/ingestao/extracao/esquema-extracao";
import type { ExtratorNotas, ResultadoExtracao } from "../src/ingestao/extracao/extrator-notas";
import { ProcessadorExtracao } from "../src/ingestao/processador-extracao";

const notaBase = JSON.parse(readFileSync("fixtures/notas/nota-03.esperado.json", "utf8")) as ExtracaoNota;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

const medidas = {
  consumo: { entrada: 2100, saida: 900, cacheLeitura: 0, cacheEscrita: 0 },
  tentativas: 1,
  latenciaMs: 800,
  modelo: "claude-sonnet-5-5",
  versaoPrompt: "extrator-v1",
};
const extratorCom = (extracao: ExtracaoNota): ExtratorNotas =>
  ({
    extrair: () => Promise.resolve({ ok: true, extracao, ...medidas } satisfies ResultadoExtracao),
  }) as unknown as ExtratorNotas;

describe("ProcessadorExtracao com o banco (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-proc-"));
  const armazenamento = new ArmazenamentoDisco({ raiz: dirArquivos, maxBytes: 1_000_000 });
  let comercianteId = "";
  let sufixo = 0;

  /** Falha só ao registrar a execução aprovada, depois de a compra já estar gravada na transação. */
  const registroQueFalhaNaAprovada = (): RegistroExecucoes => {
    const real = new RegistroExecucoesPostgres(db);
    return {
      salvar: (e: ExecucaoRegistrada, executor) =>
        e.resultado === "aprovada"
          ? Promise.reject(new Error("registro fora do ar"))
          : real.salvar(e, executor),
    };
  };

  const processador = (extracao: ExtracaoNota, registro: RegistroExecucoes) =>
    new ProcessadorExtracao({
      db,
      armazenamento,
      extrator: extratorCom(extracao),
      registro,
      limiteConfiancaItem: 0.8,
      modeloConfigurado: "claude-sonnet-5-5",
      hoje: () => "2026-10-20",
    });

  /** Cada documento precisa de um arquivo distinto (o hash é único por comerciante). */
  const novoDocumento = async () => {
    const salvo = await armazenamento.salvar(comercianteId, Buffer.concat([JPEG, Buffer.from([++sufixo])]));
    const [doc] = await db
      .insert(schema.documento)
      .values({ comercianteId, tipo: "foto_nota", arquivoCaminho: salvo.caminho, arquivoHash: salvo.hash })
      .returning({ id: schema.documento.id });
    return doc!.id;
  };

  beforeAll(async () => {
    await migrar(url);
    const [loja] = await db.insert(schema.comerciante).values({ nome: "E2E Processador" }).returning();
    comercianteId = loja!.id;
  });
  afterAll(async () => {
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, comercianteId));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  const estado = async (documentoId: string) => {
    const [doc] = await db.select().from(schema.documento).where(eq(schema.documento.id, documentoId));
    const compras = await db
      .select({ id: schema.compra.id })
      .from(schema.compra)
      .where(eq(schema.compra.documentoId, documentoId));
    const execucoes = await db
      .select()
      .from(schema.execucaoAgente)
      .where(eq(schema.execucaoAgente.entrada, `documento:${documentoId}`));
    return { doc, compras, execucoes };
  };

  it("erro ao gravar fora da última tentativa sobe para o BullMQ repetir, sem deixar nada pela metade", async () => {
    const documentoId = await novoDocumento();
    const p = processador(notaBase, registroQueFalhaNaAprovada());
    await expect(p.processar({ documentoId, comercianteId }, false)).rejects.toThrow(/registro fora do ar/);
    const { doc, compras, execucoes } = await estado(documentoId);
    expect(doc?.statusExtracao).toBe("processando");
    expect(compras).toHaveLength(0);
    expect(execucoes).toHaveLength(0);
  });

  it("erro ao gravar na última tentativa fecha o documento como falha, com a execução registrada", async () => {
    const documentoId = await novoDocumento();
    const p = processador(notaBase, registroQueFalhaNaAprovada());
    await expect(p.processar({ documentoId, comercianteId }, true)).resolves.toEqual({ status: "falha" });
    const { doc, compras, execucoes } = await estado(documentoId);
    expect(doc?.statusExtracao).toBe("falha");
    expect(doc?.erro).toMatch(/^erro_gravacao: registro fora do ar/);
    expect(compras).toHaveLength(0);
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]).toMatchObject({ resultado: "fallback_erro", gatilho: "extracao_nota" });
  });

  it("compra e execução aprovada ficam juntas: uma tentativa que dá certo grava as duas", async () => {
    const documentoId = await novoDocumento();
    const p = processador(notaBase, new RegistroExecucoesPostgres(db));
    const r = await p.processar({ documentoId, comercianteId }, false);
    expect(["extraido", "revisao"]).toContain(r.status);
    const { compras, execucoes } = await estado(documentoId);
    expect(compras).toHaveLength(1);
    expect(execucoes).toHaveLength(1);
    expect(execucoes[0]?.resultado).toBe("aprovada");
  });

  it("CNPJ ilegível não junta fornecedores diferentes numa linha só", async () => {
    const registro = new RegistroExecucoesPostgres(db);
    const fornecedorDe = async (nome: string) => {
      const documentoId = await novoDocumento();
      const nota = { ...notaBase, fornecedor: { nome, cnpj: "ilegível" } };
      await processador(nota, registro).processar({ documentoId, comercianteId }, false);
      const [c] = await db.select().from(schema.compra).where(eq(schema.compra.documentoId, documentoId));
      return c!.fornecedorId;
    };
    const um = await fornecedorDe("Distribuidora Ilegível Um");
    const dois = await fornecedorDe("Distribuidora Ilegível Dois");
    expect(um).not.toBe(dois);
    const linhas = await db
      .select({ nome: schema.fornecedor.nome, cnpj: schema.fornecedor.cnpj })
      .from(schema.fornecedor)
      .where(eq(schema.fornecedor.comercianteId, comercianteId));
    expect(linhas.filter((l) => l.nome.startsWith("Distribuidora Ilegível")).map((l) => l.cnpj)).toEqual([
      null,
      null,
    ]);
  });
});
