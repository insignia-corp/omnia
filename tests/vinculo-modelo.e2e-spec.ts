import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { RegistroExecucoesPostgres } from "../src/agente/execucao/registro-execucoes";
import { carregarEnv } from "../src/config/env";
import { ArmazenamentoDisco } from "../src/infra/armazenamento/armazenamento-disco";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import type { ExtracaoNota } from "../src/ingestao/extracao/esquema-extracao";
import type { ExtratorNotas, ResultadoExtracao } from "../src/ingestao/extracao/extrator-notas";
import { ProcessadorExtracao } from "../src/ingestao/processador-extracao";
import { responderPergunta } from "../src/ingestao/revisao/responder-pergunta";
import type {
  ClienteSugestao,
  PedidoSugestao,
  RespostaSugestao,
} from "../src/ingestao/vinculo/cliente-sugestao";
import { carregarPromptVinculo } from "../src/ingestao/vinculo/prompt-vinculo";
import { SugestorVinculo } from "../src/ingestao/vinculo/sugestor-vinculo";

interface Produto {
  id: string;
  nome: string;
  codigo_barras: string;
  unidade: string;
  categoria: string;
}

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

const nota = (descricoes: string[]): ExtracaoNota => ({
  fornecedor: { nome: "Distribuidora E2E Vínculo", cnpj: "22786541000120" },
  data_emissao: "2026-10-18",
  itens: descricoes.map((descricao) => ({
    descricao,
    quantidade: 2,
    unidade: "UN",
    valor_unitario_centavos: 500,
    valor_total_centavos: 1000,
    confianca: 1,
  })),
  total_centavos: 1000 * descricoes.length,
  confianca_documento: 1,
});

/** Modelo falso: escolhe, no catálogo que recebeu, o produto de nome `escolhe` (ou uma ref inventada). */
class ClienteFalso implements ClienteSugestao {
  chamadas = 0;
  constructor(public escolhe: string | null) {}

  sugerir(pedido: PedidoSugestao): Promise<RespostaSugestao> {
    this.chamadas++;
    const dados = JSON.parse(pedido.usuario.replace(/^<dados>/, "").replace(/<\/dados>$/, "")) as {
      itens: Array<{ ref: string }>;
      catalogo: Array<{ ref: string; nome: string }>;
    };
    const produto =
      this.escolhe === "inventado"
        ? "p9999"
        : this.escolhe
          ? (dados.catalogo.find((p) => p.nome === this.escolhe)?.ref ?? null)
          : null;
    return Promise.resolve({
      texto: JSON.stringify({
        sugestoes: dados.itens.map((i) => ({ item: i.ref, produto, confianca: 0.9 })),
      }),
      recusou: false,
      consumo: { entrada: 900, saida: 40, cacheLeitura: 0, cacheEscrita: 0 },
      modelo: "claude-haiku-5-5",
    });
  }
}

describe("sugestão de vínculo pelo modelo (e2e)", () => {
  const env = carregarEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema });
  const dirArquivos = mkdtempSync(join(tmpdir(), "omnia-vinculo-modelo-"));
  const armazenamento = new ArmazenamentoDisco({ raiz: dirArquivos, maxBytes: 1_000_000 });
  const catalogo = JSON.parse(readFileSync("fixtures/mercadinho/catalogo.json", "utf8")) as Produto[];
  const arroz = catalogo.find((p) => p.id === "P01")!;
  const produtoDb = new Map<string, string>();
  let comerciante = "";
  let sufixo = 0;

  const processador = (extracao: ExtracaoNota, cliente?: ClienteFalso) =>
    new ProcessadorExtracao({
      db,
      armazenamento,
      extrator: extratorCom(extracao),
      registro: new RegistroExecucoesPostgres(db),
      limiteConfiancaItem: 0.8,
      limiteSimilaridade: env.LIMITE_SIMILARIDADE,
      modeloConfigurado: "claude-sonnet-5-5",
      hoje: () => "2026-10-20",
      ...(cliente
        ? {
            sugestor: new SugestorVinculo(cliente, carregarPromptVinculo(), {
              modeloConfigurado: "claude-haiku-5-5",
            }),
          }
        : {}),
    });

  const novoDocumento = async () => {
    const salvo = await armazenamento.salvar(comerciante, Buffer.concat([JPEG, Buffer.from([++sufixo])]));
    const [doc] = await db
      .insert(schema.documento)
      .values({
        comercianteId: comerciante,
        tipo: "foto_nota",
        arquivoCaminho: salvo.caminho,
        arquivoHash: salvo.hash,
      })
      .returning({ id: schema.documento.id });
    return doc!.id;
  };
  const processar = async (extracao: ExtracaoNota, cliente?: ClienteFalso) => {
    const documentoId = await novoDocumento();
    const r = await processador(extracao, cliente).processar(
      { documentoId, comercianteId: comerciante },
      true,
    );
    return { documentoId, r };
  };
  const perguntasDe = (documentoId: string) =>
    db
      .select({
        p: schema.perguntaDono,
        itemId: schema.itemDeCompra.id,
        produtoId: schema.itemDeCompra.produtoId,
      })
      .from(schema.perguntaDono)
      .innerJoin(schema.itemDeCompra, eq(schema.itemDeCompra.id, schema.perguntaDono.itemDeCompraId))
      .innerJoin(schema.compra, eq(schema.compra.id, schema.itemDeCompra.compraId))
      .where(
        and(eq(schema.compra.documentoId, documentoId), eq(schema.perguntaDono.tipo, "confirmar_vinculo")),
      );
  const execucoesDeVinculo = () =>
    db
      .select()
      .from(schema.execucaoAgente)
      .where(
        and(
          eq(schema.execucaoAgente.comercianteId, comerciante),
          eq(schema.execucaoAgente.gatilho, "vinculo_produto"),
        ),
      );

  beforeAll(async () => {
    await migrar(env.DATABASE_URL);
    const [dono] = await db.insert(schema.comerciante).values({ nome: "E2E Vínculo Modelo" }).returning();
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
  });

  afterAll(async () => {
    await db.delete(schema.comerciante).where(eq(schema.comerciante.id, comerciante));
    await pool.end();
    rmSync(dirArquivos, { recursive: true, force: true });
  });

  it("a sugestão vira candidata da pergunta e não liga nada sozinha", async () => {
    const cliente = new ClienteFalso(arroz.nome);
    const { documentoId, r } = await processar(nota(["XYZ QQQ 777"]), cliente);
    expect(r.status).toBe("extraido");
    expect(cliente.chamadas).toBe(1);

    const [pergunta] = await perguntasDe(documentoId);
    expect(pergunta!.produtoId).toBeNull();
    expect(pergunta!.p.contexto).toMatchObject({
      sugestao_modelo: { produto_id: produtoDb.get("P01"), nome: arroz.nome, confianca: 0.7 },
    });
    expect(pergunta!.p.pergunta).toContain(`Parece ser: ${arroz.nome}`);

    const custos = await db
      .select()
      .from(schema.historicoCusto)
      .where(eq(schema.historicoCusto.itemDeCompraId, pergunta!.itemId));
    expect(custos).toHaveLength(0);
    const vinculos = await db
      .select()
      .from(schema.vinculoDescricaoProduto)
      .where(eq(schema.vinculoDescricaoProduto.comercianteId, comerciante));
    expect(vinculos).toHaveLength(0);

    const [execucao] = await execucoesDeVinculo();
    expect(execucao).toMatchObject({
      modelo: "claude-haiku-5-5",
      resultado: "aprovada",
      entrada: `documento:${documentoId}`,
    });
    expect(execucao!.tokensEntrada).toBe(900);
    expect(execucao!.custoEstimadoMicrodolares).toBeGreaterThan(0);
  });

  it("confirmada pelo dono, grava o vínculo como do modelo, e a próxima nota liga pela memória sem chamar o modelo", async () => {
    const cliente = new ClienteFalso(arroz.nome);
    const { documentoId } = await processar(nota(["ARROZ TIPO UM CINCO QUILOS ZZZ"]), cliente);
    const [pergunta] = await perguntasDe(documentoId);
    await responderPergunta(
      db,
      comerciante,
      pergunta!.p.id,
      { produto_id: produtoDb.get("P01") },
      { limiteConfiancaItem: 0.8 },
    );

    const [vinculo] = await db
      .select()
      .from(schema.vinculoDescricaoProduto)
      .where(eq(schema.vinculoDescricaoProduto.comercianteId, comerciante));
    expect(vinculo).toMatchObject({
      metodo: "modelo",
      confirmadoPeloDono: true,
      produtoId: produtoDb.get("P01"),
    });

    const antes = cliente.chamadas;
    const { documentoId: segundo } = await processar(nota(["ARROZ TIPO UM CINCO QUILOS ZZZ"]), cliente);
    expect(cliente.chamadas).toBe(antes);
    expect(await perguntasDe(segundo)).toHaveLength(0);
  });

  it("escolher outro produto que não o sugerido grava o vínculo como do dono", async () => {
    const cliente = new ClienteFalso(arroz.nome);
    const { documentoId } = await processar(nota(["QWERTY ASDF 0001"]), cliente);
    const [pergunta] = await perguntasDe(documentoId);
    await responderPergunta(
      db,
      comerciante,
      pergunta!.p.id,
      { produto_id: produtoDb.get("P02") },
      { limiteConfiancaItem: 0.8 },
    );
    const vinculos = await db
      .select()
      .from(schema.vinculoDescricaoProduto)
      .where(eq(schema.vinculoDescricaoProduto.produtoId, produtoDb.get("P02")!));
    expect(vinculos.at(-1)).toMatchObject({ metodo: "dono", confirmadoPeloDono: true });
  });

  it("produto inventado pelo modelo é descartado e a pergunta segue sem sugestão", async () => {
    const cliente = new ClienteFalso("inventado");
    const { documentoId } = await processar(nota(["PLMKO IJNUH 0002"]), cliente);
    const [pergunta] = await perguntasDe(documentoId);
    expect(pergunta!.p.contexto).not.toHaveProperty("sugestao_modelo");
    expect(pergunta!.p.pergunta).not.toContain("Parece ser");
  });

  it("nota que liga sozinha, com todos os itens do catálogo, não chama o modelo", async () => {
    const cliente = new ClienteFalso(arroz.nome);
    const antes = (await execucoesDeVinculo()).length;
    const { documentoId, r } = await processar(nota([arroz.nome, catalogo[1]!.nome]), cliente);
    expect(r.status).toBe("extraido");
    expect(cliente.chamadas).toBe(0);
    expect(await perguntasDe(documentoId)).toHaveLength(0);
    expect(await execucoesDeVinculo()).toHaveLength(antes);
  });

  it("job repetido para nota já resolvida não chama o modelo", async () => {
    const cliente = new ClienteFalso(arroz.nome);
    const extracao = nota(["ASDFG HJKLÇ 0003"]);
    const documentoId = await novoDocumento();
    const p = processador(extracao, cliente);
    await p.processar({ documentoId, comercianteId: comerciante }, true);
    const depois = cliente.chamadas;
    const repetido = await p.processar({ documentoId, comercianteId: comerciante }, true);
    expect(repetido.status).toBe("ignorado");
    expect(cliente.chamadas).toBe(depois);
  });

  it("sem sugestor (sem chave) o fluxo é o de antes: pergunta ao dono sem sugestão do modelo", async () => {
    const { documentoId, r } = await processar(nota(["MNBVC XZLKJ 0004"]));
    expect(r.status).toBe("extraido");
    const [pergunta] = await perguntasDe(documentoId);
    expect(pergunta!.p.contexto).not.toHaveProperty("sugestao_modelo");
  });
});
