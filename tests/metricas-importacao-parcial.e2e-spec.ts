import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { CONFIANCA_REDUZIDA } from "../src/ingestao/validacao/validar-nota";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { MetricasService } from "../src/metricas/metricas.service";
import { RepositorioMetricasPostgres } from "../src/metricas/repositorio-metricas";
import { ehDadoAusente } from "../src/metricas/resultado-metrica";

/**
 * Importação de planilha que ainda pede revisão do dono (regras invioláveis 3 e 4): as vendas
 * que ela gravou entram nas métricas, mas nunca com confiança 1, e a confiança volta quando o
 * documento passa a extraído. Venda de outro comerciante nunca entra na conta.
 */

const DIA_CONFIAVEL = "2026-10-10";
const DIA_SEM_DOCUMENTO = "2026-10-11";
const DIA_PARCIAL = "2026-10-12";
const DIA_COM_FALHA = "2026-10-13";
const DIA_DE_CONFIANCA_BAIXA = "2026-10-14";

describe("métricas e importação parcial de planilha (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = drizzle(pool, { schema });
  const repositorio = new RepositorioMetricasPostgres(db);
  const servico = new MetricasService(repositorio);

  let comercianteId: string;
  let outroId: string;
  let produtoId: string;
  let documentoParcialId: string;

  async function novoDocumento(
    dono: string,
    hash: string,
    status: "pendente" | "processando" | "extraido" | "revisao" | "falha",
  ) {
    const [doc] = await db
      .insert(schema.documento)
      .values({
        comercianteId: dono,
        tipo: "planilha",
        arquivoCaminho: `teste/${hash}.csv`,
        arquivoHash: hash,
        statusExtracao: status,
      })
      .returning({ id: schema.documento.id });
    if (!doc) throw new Error("documento não criado");
    return doc.id;
  }

  async function novaVenda(
    dono: string,
    produto: string,
    documentoId: string | null,
    data: string,
    confianca = 1,
  ) {
    const [v] = await db
      .insert(schema.venda)
      .values({
        comercianteId: dono,
        documentoId,
        data,
        numeroCupom: `cupom-${data}`,
        totalCentavos: 1000,
        origem: "planilha",
        confianca,
      })
      .returning({ id: schema.venda.id });
    if (!v) throw new Error("venda não criada");
    await db.insert(schema.itemDeVenda).values({
      comercianteId: dono,
      vendaId: v.id,
      produtoId: produto,
      quantidade: 1,
      precoUnitarioCentavos: 1000,
      valorTotalCentavos: 1000,
    });
  }

  async function novoComercianteComProduto(nome: string) {
    const [c] = await db.insert(schema.comerciante).values({ nome }).returning({ id: schema.comerciante.id });
    if (!c) throw new Error("comerciante não criado");
    const [p] = await db
      .insert(schema.produto)
      .values({ comercianteId: c.id, nome: "Arroz", origem: "planilha" })
      .returning({ id: schema.produto.id });
    if (!p) throw new Error("produto não criado");
    return { comercianteId: c.id, produtoId: p.id };
  }

  beforeAll(async () => {
    await migrar(url);
    ({ comercianteId, produtoId } = await novoComercianteComProduto("Teste importação parcial A"));
    const outro = await novoComercianteComProduto("Teste importação parcial B");
    outroId = outro.comercianteId;

    const resolvido = await novoDocumento(comercianteId, "hash-resolvido", "extraido");
    documentoParcialId = await novoDocumento(comercianteId, "hash-parcial", "revisao");
    await novaVenda(comercianteId, produtoId, resolvido, DIA_CONFIAVEL);
    await novaVenda(comercianteId, produtoId, null, DIA_SEM_DOCUMENTO);
    await novaVenda(comercianteId, produtoId, documentoParcialId, DIA_PARCIAL);
    const comFalha = await novoDocumento(comercianteId, "hash-falha", "falha");
    await novaVenda(comercianteId, produtoId, comFalha, DIA_COM_FALHA);
    // A confiança da própria venda já é menor que o teto: o teto não a sobe.
    await novaVenda(comercianteId, produtoId, documentoParcialId, DIA_DE_CONFIANCA_BAIXA, 0.3);

    // Outro lojista, com planilha em revisão no mesmo dia: não pode contaminar o primeiro.
    const parcialDoOutro = await novoDocumento(outroId, "hash-parcial-outro", "revisao");
    await novaVenda(outroId, outro.produtoId, parcialDoOutro, DIA_CONFIAVEL);
  });

  afterAll(async () => {
    for (const id of [comercianteId, outroId]) {
      await db.delete(schema.comerciante).where(eq(schema.comerciante.id, id));
    }
    await pool.end();
  });

  const confiancaPorDia = async () => {
    const dias = await repositorio.vendasPorDia(comercianteId, DIA_CONFIAVEL, DIA_PARCIAL);
    return Object.fromEntries(dias.map((d) => [d.data, d.menorConfianca]));
  };

  it("a venda de planilha em revisão entra com confiança reduzida; a resolvida e a sem documento, com 1", async () => {
    expect(await confiancaPorDia()).toEqual({
      [DIA_CONFIAVEL]: 1,
      [DIA_SEM_DOCUMENTO]: 1,
      [DIA_PARCIAL]: CONFIANCA_REDUZIDA,
    });
  });

  it("documento com falha também reduz, e o teto nunca sobe uma confiança que já era menor", async () => {
    const dias = await repositorio.vendasPorDia(comercianteId, DIA_COM_FALHA, DIA_DE_CONFIANCA_BAIXA);
    expect(dias.map((d) => [d.data, d.menorConfianca])).toEqual([
      [DIA_COM_FALHA, CONFIANCA_REDUZIDA],
      [DIA_DE_CONFIANCA_BAIXA, 0.3],
    ]);
  });

  it("vendas por produto e última venda do produto carregam a mesma confiança reduzida", async () => {
    const porProduto = await repositorio.vendasPorProdutoPorDia(comercianteId, DIA_CONFIAVEL, DIA_PARCIAL);
    expect(porProduto.map((v) => [v.data, v.menorConfianca])).toEqual([
      [DIA_CONFIAVEL, 1],
      [DIA_SEM_DOCUMENTO, 1],
      [DIA_PARCIAL, CONFIANCA_REDUZIDA],
    ]);
    const ultimas = await repositorio.ultimasVendasPorProduto(comercianteId, DIA_PARCIAL);
    expect(ultimas).toEqual([
      expect.objectContaining({ produtoId, data: DIA_PARCIAL, menorConfianca: CONFIANCA_REDUZIDA }),
    ]);
  });

  it("o resumo do dia da importação parcial devolve menor confiança reduzida, nunca 1", async () => {
    const contexto = { comercianteId, dataReferencia: DIA_PARCIAL };
    const parcial = await servico.resumoDiario(contexto, DIA_PARCIAL);
    if (ehDadoAusente(parcial)) throw new Error(`Esperava resumo, veio ausente: ${parcial.codigo}`);
    expect(parcial.menor_confianca).toBe(CONFIANCA_REDUZIDA);

    const confiavel = await servico.resumoDiario(contexto, DIA_CONFIAVEL);
    if (ehDadoAusente(confiavel)) throw new Error(`Esperava resumo, veio ausente: ${confiavel.codigo}`);
    expect(confiavel.menor_confianca).toBe(1);
  });

  it("a planilha em revisão de outro lojista não muda a confiança deste", async () => {
    expect((await confiancaPorDia())[DIA_CONFIAVEL]).toBe(1);
  });

  it("quando o documento passa a extraído, a confiança volta ao valor original", async () => {
    await db
      .update(schema.documento)
      .set({ statusExtracao: "extraido" })
      .where(eq(schema.documento.id, documentoParcialId));
    expect((await confiancaPorDia())[DIA_PARCIAL]).toBe(1);
  });
});
