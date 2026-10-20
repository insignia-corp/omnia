import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { extracaoNotaSchema } from "../src/ingestao/extracao/esquema-extracao";
import { buscarVinculo, registrarVinculo } from "../src/ingestao/vinculo/vincular-produto";

interface Manifesto {
  id: string;
  fornecedor_id: string;
  data_emissao: string;
  vinculos_produto: string[];
}
interface ProdutoFixture {
  id: string;
  nome: string;
  codigo_barras: string;
  unidade: string;
  categoria: string;
}
interface FornecedorFixture {
  id: string;
  nome: string;
  cnpj: string;
}

const lerJson = <T>(caminho: string): T => JSON.parse(readFileSync(caminho, "utf8")) as T;

describe("vínculo da descrição da nota com o produto (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  const catalogo = lerJson<ProdutoFixture[]>("fixtures/mercadinho/catalogo.json");
  const fornecedores = lerJson<FornecedorFixture[]>("fixtures/mercadinho/fornecedores.json");
  const manifesto = lerJson<Manifesto[]>("fixtures/notas/manifesto.json").sort(
    (a, b) => a.data_emissao.localeCompare(b.data_emissao) || a.id.localeCompare(b.id),
  );
  const produtoDb = new Map<string, string>();
  const fornecedorDb = new Map<string, string>();
  let comerciante = "";

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    const [dono] = await db.insert(schema.comerciante).values({ nome: "E2E Vínculo" }).returning();
    comerciante = dono!.id;
    const produtos = await db
      .insert(schema.produto)
      .values(
        catalogo.map((p) => ({
          comercianteId: comerciante,
          nome: p.nome,
          codigoBarras: p.codigo_barras,
          unidade: p.unidade,
          categoria: p.categoria,
          origem: "planilha" as const,
        })),
      )
      .returning({ id: schema.produto.id, codigoBarras: schema.produto.codigoBarras });
    for (const p of catalogo)
      produtoDb.set(p.id, produtos.find((x) => x.codigoBarras === p.codigo_barras)!.id);
    const forns = await db
      .insert(schema.fornecedor)
      .values(
        fornecedores.map((f) => ({
          comercianteId: comerciante,
          nome: f.nome,
          cnpj: f.cnpj,
          origem: "foto_nota" as const,
        })),
      )
      .returning({ id: schema.fornecedor.id, cnpj: schema.fornecedor.cnpj });
    for (const f of fornecedores) fornecedorDb.set(f.id, forns.find((x) => x.cnpj === f.cnpj)!.id);
  });

  afterAll(async () => {
    await db.delete(schema.comerciante).where(inArray(schema.comerciante.id, [comerciante]));
    await pool.end();
  });

  it("mede quantos itens ligam sozinhos ao produto certo, e nenhum liga ao produto errado", async () => {
    const t = {
      total: 0,
      memoria: 0,
      similaridadeCerto: 0,
      errado: 0,
      perguntados: 0,
      certoEntreSugestoes: 0,
    };
    for (const nota of manifesto) {
      const extracao = extracaoNotaSchema.parse(lerJson(`fixtures/notas/${nota.id}.esperado.json`));
      for (const [i, item] of extracao.itens.entries()) {
        const esperado = produtoDb.get(nota.vinculos_produto[i]!)!;
        const fornecedorId = fornecedorDb.get(nota.fornecedor_id)!;
        const r = await buscarVinculo(db, {
          comercianteId: comerciante,
          fornecedorId,
          descricao: item.descricao,
          limiteSimilaridade: env.LIMITE_SIMILARIDADE,
        });
        t.total++;
        if (r.tipo === "vinculado") {
          if (r.produtoId !== esperado) t.errado++;
          else if (r.metodo === "dono") t.memoria++;
          else t.similaridadeCerto++;
        } else {
          t.perguntados++;
          if (r.tipo === "sugestao" && r.candidatos.some((c) => c.produtoId === esperado))
            t.certoEntreSugestoes++;
        }
        // O dono responde o que foi perguntado e a resposta fica guardada para as próximas notas.
        if (r.tipo !== "vinculado" || r.produtoId !== esperado) {
          await registrarVinculo(db, {
            comercianteId: comerciante,
            fornecedorId,
            descricao: item.descricao,
            produtoId: esperado,
            metodo: "dono",
            confianca: 1,
            confirmadoPeloDono: true,
          });
        }
      }
    }
    expect(t.total).toBe(94);
    // Ligar ao produto errado contamina o histórico de custo: nenhum caso pode passar.
    expect(t.errado).toBe(0);
    // Critério de pronto da issue #27: pelo menos 90% sem perguntar.
    expect((t.memoria + t.similaridadeCerto) / t.total).toBeGreaterThanOrEqual(0.9);
    // O que sobra vai ao dono com o produto certo entre as sugestões.
    expect(t.certoEntreSugestoes).toBe(t.perguntados);
  });
});
