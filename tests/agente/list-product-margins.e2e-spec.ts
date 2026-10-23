import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { montarCatalogo } from "../../src/agente/ferramentas/catalogo";
import type { ContextoSessao } from "../../src/agente/ferramentas/ferramenta";
import type { ListaDeMargens } from "../../src/agente/ferramentas/plano-a/list-product-margins";
import { RegistroFerramentas } from "../../src/agente/ferramentas/registro-ferramentas";
import { carregarEnv } from "../../src/config/env";
import { migrar } from "../../src/infra/database/migrar";
import * as schema from "../../src/infra/database/schema";
import { semear } from "../../src/infra/database/seed/semear";
import { NumerosAutorizados, verificarNumeros } from "../../src/lib/verificador-numeros/verificador-numeros";

/**
 * `list_product_margins` pelo registro, como o agente a chama, contra o seed e o gabarito das métricas
 * (fixtures/gabarito/metricas.json): a lista de abaixo da meta bate com o gabarito, outro lojista nunca
 * aparece e o verificador (regra 8) aceita os números que a ferramenta devolve.
 */

interface Gabarito {
  parametros: { data_referencia: string };
  margem_por_produto: Array<{
    produto_id: string;
    nome: string;
    situacao: string;
    margem_bps: number | null;
    abaixo_da_meta: boolean | null;
  }>;
}
const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;
const REF = gabarito.parametros.data_referencia;
const comMargem = gabarito.margem_por_produto.filter((m) => m.situacao === "ok");
const abaixo = comMargem.filter((m) => m.abaixo_da_meta);

interface Saida {
  valor: ListaDeMargens;
  periodo: { inicio: string; fim: string };
  n_registros: number;
  menor_confianca: number | null;
  origens: string[];
}

describe("list_product_margins (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  const registro = new RegistroFerramentas(montarCatalogo({ db }));
  let vilaNova: ContextoSessao;
  let esquina: ContextoSessao;

  const chamar = async (contexto: ContextoSessao, entrada: unknown) => {
    const r = await registro.executar(contexto, "list_product_margins", entrada);
    if (!r.ok) throw new Error(r.erro);
    return r.saida as Saida;
  };

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
  });
  afterAll(() => pool.end());

  it("o catálogo registra a ferramenta", () => {
    expect(registro.nomes).toContain("list_product_margins");
  });

  it("abaixo_da_meta: o total e os produtos batem com o gabarito, da menor margem para a maior", async () => {
    const saida = await chamar(vilaNova, { filtro: "abaixo_da_meta", limite: 10 });
    expect(saida.valor.total_que_atendem).toBe(abaixo.length);
    expect(saida.valor.total_com_margem).toBe(comMargem.length);
    expect(saida.valor.produtos_sem_dado).toBe(gabarito.margem_por_produto.length - comMargem.length);
    const esperado = [...abaixo].sort((a, b) => a.margem_bps! - b.margem_bps!);
    expect(saida.valor.produtos.map((p) => [p.nome, p.margem_bps])).toEqual(
      esperado.map((m) => [m.nome, m.margem_bps]),
    );
    expect(saida.valor.meta_percentual).toEqual(expect.any(Number));
    expect(saida.menor_confianca).toEqual(expect.any(Number));
    expect(saida.periodo.fim).toBe(REF);
  });

  it("limite corta a lista, mas o total continua o de todos os que atendem ('quantos estão abaixo da meta')", async () => {
    const saida = await chamar(vilaNova, { filtro: "abaixo_da_meta", limite: 1 });
    expect(saida.valor.produtos).toHaveLength(1);
    expect(saida.valor.total_que_atendem).toBe(abaixo.length);
  });

  it("menor e maior margem de todos os produtos batem com o gabarito", async () => {
    const ordenado = [...comMargem].sort((a, b) => a.margem_bps! - b.margem_bps!);
    const menor = await chamar(vilaNova, { ordenar: "menor_margem", limite: 1 });
    const maior = await chamar(vilaNova, { ordenar: "maior_margem", limite: 1 });
    expect(menor.valor.produtos[0]).toMatchObject({ margem_bps: ordenado[0]!.margem_bps });
    expect(maior.valor.produtos[0]).toMatchObject({ margem_bps: ordenado.at(-1)!.margem_bps });
    expect(menor.valor.total_que_atendem).toBe(comMargem.length);
  });

  it("outro lojista nunca aparece: só produtos do próprio comerciante da sessão", async () => {
    const daVila = new Set(
      (
        await db
          .select({ id: schema.produto.id })
          .from(schema.produto)
          .where(eq(schema.produto.comercianteId, vilaNova.comercianteId))
      ).map((p) => p.id),
    );
    const doEsquina = await db
      .select({ id: schema.produto.id })
      .from(schema.produto)
      .where(eq(schema.produto.comercianteId, esquina.comercianteId));
    const saidaVila = await chamar(vilaNova, { limite: 10 });
    expect(saidaVila.valor.produtos.every((p) => daVila.has(p.produto_id))).toBe(true);
    const saidaEsquina = await chamar(esquina, { limite: 10 });
    const idsEsquina = new Set(doEsquina.map((p) => p.id));
    const daEsquina = saidaEsquina.valor.produtos ?? [];
    expect(daEsquina.every((p) => idsEsquina.has(p.produto_id))).toBe(true);
    expect(daEsquina.some((p) => daVila.has(p.produto_id))).toBe(false);
  });

  it("regra 8: o verificador aceita o total, a meta e as margens que a ferramenta devolve", async () => {
    const saida = await chamar(vilaNova, { filtro: "abaixo_da_meta" });
    const pior = saida.valor.produtos[0]!;
    const autorizados = new NumerosAutorizados([saida]);
    const mensagem =
      `${saida.valor.total_que_atendem} produtos estão abaixo da meta de ${saida.valor.meta_percentual}%. ` +
      `O pior é ${pior.nome}, com ${String(pior.margem_percentual).replace(".", ",")}% de margem.`;
    expect(verificarNumeros(mensagem, autorizados).aprovado).toBe(true);
    expect(
      verificarNumeros(`${saida.valor.total_que_atendem + 17} produtos estão abaixo da meta.`, autorizados)
        .aprovado,
    ).toBe(false);
  });
});
