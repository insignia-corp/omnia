import { drizzle } from "drizzle-orm/node-postgres";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { Pool } from "pg";
import { lerArquivoEnv } from "../../src/config/arquivo-env";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as s from "../../src/infra/database/schema";
import { normalizarDescricao } from "../../src/ingestao/normalizar-descricao";
import {
  CATALOGO_PITCH,
  csvVendasPitch,
  COMERCIANTE_PITCH,
  FIM_VENDAS,
  FORNECEDOR_PITCH,
  gerarVendasPitch,
  hashPitch,
  idPitch,
  NOTAS_ANTERIORES,
  resumirVendasPitch,
} from "./dados";

type Db = ReturnType<typeof drizzle<typeof s>>;
const instante = (data: string) => new Date(`${data}T12:00:00-03:00`);

/** Só insere os dados fictícios. O reset destrutivo fica exclusivamente no comando abaixo. */
export async function semearPitch(db: Db) {
  const vendas = gerarVendasPitch();
  const fornecedorId = idPitch("fornecedor", "sao-jorge");
  const documentoVendasId = idPitch("documento", "vendas");
  const criadoEm = instante("2026-09-01");
  await db.transaction(async (tx) => {
    await tx.insert(s.comerciante).values({
      id: COMERCIANTE_PITCH,
      nome: "Mercadinho Bom Preço",
      telefoneWhatsapp: "5562900000024",
      margemMetaBps: 2500,
      criadoEm,
    });
    await tx.insert(s.consentimento).values({
      id: idPitch("consentimento"),
      comercianteId: COMERCIANTE_PITCH,
      tipo: "notas",
      versaoTermo: "pitch-ficticio",
      concedidoEm: criadoEm,
    });
    await tx.insert(s.fornecedor).values({
      id: fornecedorId,
      comercianteId: COMERCIANTE_PITCH,
      ...FORNECEDOR_PITCH,
      origem: "dono",
      confianca: 1,
      criadoEm,
    });
    await tx.insert(s.produto).values(
      CATALOGO_PITCH.map((p) => ({
        id: p.produto_id,
        comercianteId: COMERCIANTE_PITCH,
        nome: p.nome,
        codigoBarras: p.codigo_barras,
        sku: p.chave,
        unidade: "UN",
        origem: "planilha" as const,
        confianca: 1,
        criadoEm,
      })),
    );
    await tx.insert(s.documento).values({
      id: documentoVendasId,
      comercianteId: COMERCIANTE_PITCH,
      tipo: "planilha",
      arquivoCaminho: "fixtures/pitch/vendas.csv",
      arquivoHash: hashPitch(csvVendasPitch(vendas)),
      statusExtracao: "extraido",
      confiancaMedia: 1,
      criadoEm,
      processadoEm: instante(FIM_VENDAS),
    });
    const vinculados = new Set<string>();
    for (const nota of NOTAS_ANTERIORES) {
      const documentoId = idPitch("documento", nota.chave);
      const compraId = idPitch("compra", nota.chave);
      const data = instante(nota.data);
      await tx.insert(s.documento).values({
        id: documentoId,
        comercianteId: COMERCIANTE_PITCH,
        tipo: "foto_nota",
        arquivoCaminho: `fixtures/pitch/${nota.chave}.esperado.json`,
        arquivoHash: hashPitch(JSON.stringify(nota.extracao, null, 2) + "\n"),
        statusExtracao: "extraido",
        confiancaMedia: 1,
        extracaoJson: nota.extracao,
        criadoEm: data,
        processadoEm: data,
      });
      await tx.insert(s.compra).values({
        id: compraId,
        comercianteId: COMERCIANTE_PITCH,
        documentoId,
        fornecedorId,
        data: nota.data,
        numeroDocumento: `PITCH-${nota.chave}`,
        totalCentavos: nota.extracao.total_centavos,
        somaItensCentavos: nota.extracao.total_centavos,
        origem: "foto_nota",
        confianca: 1,
        criadoEm: data,
      });
      for (const [i, item] of nota.extracao.itens.entries()) {
        const produto = CATALOGO_PITCH.find((p) => p.chave === nota.produtos[i])!;
        const itemId = idPitch("item_compra", `${nota.chave}/${i}`);
        await tx.insert(s.itemDeCompra).values({
          id: itemId,
          comercianteId: COMERCIANTE_PITCH,
          compraId,
          produtoId: produto.produto_id,
          ordem: i + 1,
          descricaoNota: item.descricao,
          quantidade: item.quantidade,
          unidade: item.unidade,
          valorUnitarioCentavos: item.valor_unitario_centavos,
          valorTotalCentavos: item.valor_total_centavos,
          origem: "foto_nota",
          confianca: 1,
          revisaoPendente: false,
          criadoEm: data,
        });
        await tx.insert(s.historicoCusto).values({
          id: idPitch("custo", `${nota.chave}/${i}`),
          comercianteId: COMERCIANTE_PITCH,
          fornecedorId,
          produtoId: produto.produto_id,
          itemDeCompraId: itemId,
          data: nota.data,
          custoUnitarioCentavos: item.valor_unitario_centavos,
          origem: "foto_nota",
          confianca: 1,
          criadoEm: data,
        });
        if (!vinculados.has(produto.chave)) {
          await tx.insert(s.vinculoDescricaoProduto).values({
            id: idPitch("vinculo", produto.chave),
            comercianteId: COMERCIANTE_PITCH,
            fornecedorId,
            produtoId: produto.produto_id,
            descricaoNormalizada: normalizarDescricao(item.descricao),
            metodo: "dono",
            confirmadoPeloDono: true,
            confirmadoEm: data,
            confianca: 1,
            criadoEm: data,
          });
          vinculados.add(produto.chave);
        }
      }
    }
    // Lotes pequenos respeitam o limite de parâmetros do PostgreSQL.
    for (let inicio = 0; inicio < vendas.length; inicio += 250) {
      const lote = vendas.slice(inicio, inicio + 250);
      await tx.insert(s.venda).values(
        lote.map((v) => ({
          id: idPitch("venda", v.cupom),
          comercianteId: COMERCIANTE_PITCH,
          documentoId: documentoVendasId,
          data: v.data,
          hora: "12:00:00",
          numeroCupom: v.cupom,
          totalCentavos: v.total_centavos,
          origem: "planilha" as const,
          confianca: 1,
          criadoEm: instante(v.data),
        })),
      );
      await tx.insert(s.itemDeVenda).values(
        lote.flatMap((v) =>
          v.itens.map((item, i) => ({
            id: idPitch("item_venda", `${v.cupom}/${i}`),
            comercianteId: COMERCIANTE_PITCH,
            vendaId: idPitch("venda", v.cupom),
            produtoId: item.produto.produto_id,
            quantidade: item.quantidade,
            precoUnitarioCentavos: item.produto.preco_centavos,
            valorTotalCentavos: item.quantidade * item.produto.preco_centavos,
          })),
        ),
      );
    }
    await tx.insert(s.mensagem).values({
      id: idPitch("mensagem", "boa-noite"),
      comercianteId: COMERCIANTE_PITCH,
      direcao: "recebida",
      canal: "web",
      texto: "Boa noite! Aqui é o Seu João. Amanhã quero conferir como foi a sexta no Bom Preço.",
      tipo: "text",
      status: "read",
      proativa: false,
      dataEnvio: FIM_VENDAS,
      idExterno: "pitch-joao-23-noite",
      criadoEm: new Date("2026-10-23T21:00:00-03:00"),
    });
  });
  return {
    comerciante_id: COMERCIANTE_PITCH,
    comercio: "Mercadinho Bom Preço",
    dono: "Seu João",
    produtos: CATALOGO_PITCH.length,
    vendas: vendas.length,
    dias: resumirVendasPitch(vendas),
  };
}

/** Uso explícito e destrutivo, como seed:demo: parar a API antes de executar. */
async function main() {
  lerArquivoEnv();
  const env = carregarEnv();
  if (env.NODE_ENV === "production") throw new Error("seed:pitch não roda em produção.");
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
  const filas = ["extrair-nota", "reajuste-pos-nota", "relatorio-diario"].map(
    (nome) => new Queue(nome, { connection: redis }),
  );
  try {
    for (const fila of filas) {
      if (await fila.getActiveCount())
        throw new Error("Pare a API e os workers antes de seed:pitch: há job ativo.");
    }
    // Não limpar outros dados do Redis. Os ids fixos dos jobs destas filas também precisam recomeçar.
    for (const fila of filas) await fila.obliterate();
    await pool.query(
      "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;",
    );
    await migrar(env.DATABASE_URL);
    const resumo = await semearPitch(drizzle(pool, { schema: s }));
    console.log(JSON.stringify(resumo, null, 2));
  } finally {
    await Promise.all(filas.map((fila) => fila.close()));
    await redis.quit();
    await pool.end();
  }
}

if (require.main === module)
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
