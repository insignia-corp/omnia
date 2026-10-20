import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { inArray } from "drizzle-orm";
import { Pool } from "pg";
import { lerArquivoEnv } from "../../../config/arquivo-env";
import { carregarEnv } from "../../../config/env";
import * as schema from "../schema";
import { carregarFixtures, type Fixtures } from "./carregar-fixtures";
import { montarSeed, recortar, type LinhasSeed, type OpcoesComerciante } from "./montar-seed";

type Db = NodePgDatabase<typeof schema>;

/** Dois comerciantes: o da demo e um menor, para os testes de isolamento entre lojistas. */
export function comerciantesDoSeed(fix: Fixtures): Array<{ opcoes: OpcoesComerciante; dados: Fixtures }> {
  return [
    {
      opcoes: {
        chave: "vila-nova",
        nome: fix.perfil.nome,
        telefoneWhatsapp: fix.perfil.telefone_whatsapp,
        margemMetaBps: fix.perfil.margem_meta_bps,
      },
      dados: fix,
    },
    {
      opcoes: {
        chave: "esquina-24h",
        nome: "Conveniência Esquina 24h",
        telefoneWhatsapp: "5562900000001",
        margemMetaBps: 3000,
      },
      dados: recortar(fix, { produtos: 12, ultimosDias: 14 }),
    },
  ];
}

const LOTE = 1000;

async function inserirEmLotes<T>(linhas: T[], inserir: (lote: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < linhas.length; i += LOTE) await inserir(linhas.slice(i, i + LOTE));
}

async function inserir(tx: Db, l: LinhasSeed): Promise<void> {
  await tx.insert(schema.comerciante).values(l.comerciante);
  await tx.insert(schema.consentimento).values(l.consentimentos);
  await tx.insert(schema.conta).values(l.conta);
  await tx.insert(schema.fornecedor).values(l.fornecedores);
  await tx.insert(schema.produto).values(l.produtos);
  await tx.insert(schema.documento).values(l.documentos);
  await tx.insert(schema.compra).values(l.compras);
  await tx.insert(schema.itemDeCompra).values(l.itensDeCompra);
  if (l.vinculos.length) await tx.insert(schema.vinculoDescricaoProduto).values(l.vinculos);
  await tx.insert(schema.historicoCusto).values(l.historicoCusto);
  if (l.perguntas.length) await tx.insert(schema.perguntaDono).values(l.perguntas);
  await inserirEmLotes(l.vendas, (lote) => tx.insert(schema.venda).values(lote));
  await inserirEmLotes(l.itensDeVenda, (lote) => tx.insert(schema.itemDeVenda).values(lote));
  await inserirEmLotes(l.transacoes, (lote) => tx.insert(schema.transacao).values(lote));
}

export interface ResumoSeed {
  comerciante: string;
  comercianteId: string;
  produtos: number;
  fornecedores: number;
  compras: number;
  vendas: number;
  itensDeVenda: number;
  transacoes: number;
  perguntasPendentes: number;
}

/**
 * Carrega o mercadinho de demonstração. Idempotente: apaga os comerciantes do seed (em cascata,
 * como na exclusão a pedido do lojista) e recarrega, com ids e datas fixos, então o banco fica
 * sempre no mesmo estado. Tudo numa transação.
 */
export async function semear(db: Db, fix: Fixtures = carregarFixtures()): Promise<ResumoSeed[]> {
  const comerciantes = comerciantesDoSeed(fix).map(({ opcoes, dados }) => montarSeed(dados, opcoes));
  await db.transaction(async (tx) => {
    // `omnia.exclusao_autorizada` libera o DELETE do histórico append-only só nesta transação.
    await tx.execute(`SET LOCAL omnia.exclusao_autorizada = 'on'`);
    await tx.delete(schema.comerciante).where(
      inArray(
        schema.comerciante.id,
        comerciantes.map((c) => c.comerciante.id as string),
      ),
    );
    await tx.execute(`SET LOCAL omnia.exclusao_autorizada = 'off'`);
    for (const linhas of comerciantes) await inserir(tx, linhas);
  });
  return comerciantes.map((c) => ({
    comerciante: c.comerciante.nome,
    comercianteId: c.comerciante.id as string,
    produtos: c.produtos.length,
    fornecedores: c.fornecedores.length,
    compras: c.compras.length,
    vendas: c.vendas.length,
    itensDeVenda: c.itensDeVenda.length,
    transacoes: c.transacoes.length,
    perguntasPendentes: c.perguntas.length,
  }));
}

if (require.main === module) {
  lerArquivoEnv();
  const env = carregarEnv();
  if (env.NODE_ENV === "production") {
    console.error("db:seed não roda em produção.");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  semear(drizzle(pool, { schema }))
    .then((resumo) => {
      console.table(resumo);
      console.log("Seed carregado.");
    })
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => void pool.end());
}
