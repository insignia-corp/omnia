import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { carregarEnv } from "../src/config/env";
import { migrar } from "../src/infra/database/migrar";
import * as schema from "../src/infra/database/schema";
import { semear } from "../src/infra/database/seed/semear";

interface Gabarito {
  resumo_diario: {
    referencia: {
      data: string;
      faturamento_centavos: number;
      cupons: number;
      saldo_da_conta_centavos: number;
    };
  };
  variacao_de_custo: Array<{
    produto_id: string;
    custo_anterior_centavos: number;
    custo_atual_centavos: number;
  }>;
}

const gabarito = JSON.parse(readFileSync("fixtures/gabarito/metricas.json", "utf8")) as Gabarito;

describe("modelo de dados e seed (e2e)", () => {
  const url = carregarEnv().DATABASE_URL;
  const pool = new Pool({ connectionString: url, max: 4 });
  const db = drizzle(pool, { schema });
  let vilaNova = "";
  let esquina = "";

  const consultar = async <T extends Record<string, unknown>>(texto: string, valores: unknown[] = []) =>
    (await pool.query<T>(texto, valores)).rows;
  const falha = async (texto: string, valores: unknown[] = []) =>
    pool.query(texto, valores).then(
      () => null,
      (e: Error & { code?: string }) => e,
    );

  beforeAll(async () => {
    await migrar(url);
    const resumo = await semear(db);
    vilaNova = resumo.find((r) => r.comerciante === "Mercadinho Vila Nova")!.comercianteId;
    esquina = resumo.find((r) => r.comerciante === "Conveniência Esquina 24h")!.comercianteId;
  });
  afterAll(() => pool.end());

  describe("seed", () => {
    const TABELAS = [
      "comerciante",
      "consentimento",
      "conta",
      "fornecedor",
      "produto",
      "documento",
      "compra",
      "item_de_compra",
      "vinculo_descricao_produto",
      "historico_custo",
      "venda",
      "item_de_venda",
      "transacao",
      "pergunta_dono",
    ];

    /** Impressão digital do conteúdo das tabelas do seed, para comparar duas cargas. */
    const impressao = async (): Promise<Record<string, string>> => {
      const saida: Record<string, string> = {};
      for (const tabela of TABELAS) {
        const filtro = tabela === "comerciante" ? "id" : "comerciante_id";
        const [linha] = await consultar<{ h: string }>(
          `select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) as h
             from ${tabela} t where ${filtro} = any($1)`,
          [[vilaNova, esquina]],
        );
        saida[tabela] = linha!.h;
      }
      return saida;
    };

    it("é idempotente: carregar de novo deixa o banco exatamente no mesmo estado", async () => {
      const antes = await impressao();
      await semear(db);
      expect(await impressao()).toEqual(antes);
    });

    it("carrega dois comerciantes com dados diferentes", async () => {
      const [a] = await consultar<{ n: string }>("select count(*) n from venda where comerciante_id = $1", [
        vilaNova,
      ]);
      const [b] = await consultar<{ n: string }>("select count(*) n from venda where comerciante_id = $1", [
        esquina,
      ]);
      expect(Number(a!.n)).toBeGreaterThan(Number(b!.n));
      expect(Number(b!.n)).toBeGreaterThan(0);
    });

    it("reproduz o faturamento, os cupons e o saldo da conta do gabarito", async () => {
      const ref = gabarito.resumo_diario.referencia;
      const [dia] = await consultar<{ faturamento: string; cupons: string }>(
        `select sum(i.valor_total_centavos) faturamento, count(distinct v.id) cupons
           from venda v join item_de_venda i on i.venda_id = v.id and i.comerciante_id = v.comerciante_id
          where v.comerciante_id = $1 and v.data = $2`,
        [vilaNova, ref.data],
      );
      expect(Number(dia!.faturamento)).toBe(ref.faturamento_centavos);
      expect(Number(dia!.cupons)).toBe(ref.cupons);

      const [saldo] = await consultar<{ saldo: string }>(
        `select c.saldo_inicial_centavos
                + coalesce(sum(case t.tipo when 'entrada' then t.valor_centavos else -t.valor_centavos end), 0) saldo
           from conta c left join transacao t on t.conta_id = c.id and t.comerciante_id = c.comerciante_id and t.data <= $2
          where c.comerciante_id = $1 group by c.saldo_inicial_centavos`,
        [vilaNova, ref.data],
      );
      expect(Number(saldo!.saldo)).toBe(ref.saldo_da_conta_centavos);
    });

    it("guarda o histórico de custo por produto e fornecedor, com o reajuste plantado", async () => {
      const reajuste = gabarito.variacao_de_custo[0]!;
      const linhas = await consultar<{ custo: string; data: string }>(
        `select h.custo_unitario_centavos custo, h.data::text data
           from historico_custo h join produto p on p.id = h.produto_id and p.comerciante_id = h.comerciante_id
          where h.comerciante_id = $1 and p.sku = $2 order by h.data, h.criado_em`,
        [vilaNova, reajuste.produto_id],
      );
      const custos = linhas.map((l) => Number(l.custo));
      expect(custos.at(-1)).toBe(reajuste.custo_atual_centavos);
      expect(custos).toContain(reajuste.custo_anterior_centavos);
    });

    it("deixa o item ilegível em revisão, com a pergunta pendente ligada a ele", async () => {
      const [item] = await consultar<{ id: string }>(
        "select id from item_de_compra where comerciante_id = $1 and revisao_pendente",
        [vilaNova],
      );
      expect(item).toBeDefined();
      const [pergunta] = await consultar<{ status: string; tipo: string; item: string }>(
        "select status, tipo, item_de_compra_id item from pergunta_dono where comerciante_id = $1",
        [vilaNova],
      );
      expect(pergunta).toEqual({ status: "pendente", tipo: "confirmar_item", item: item!.id });
    });
  });

  describe("isolamento entre comerciantes", () => {
    it("o banco recusa um item de venda de um comerciante apontando para a venda de outro", async () => {
      const [v] = await consultar<{ id: string }>("select id from venda where comerciante_id = $1 limit 1", [
        vilaNova,
      ]);
      const [p] = await consultar<{ id: string }>(
        "select id from produto where comerciante_id = $1 limit 1",
        [esquina],
      );
      const erro = await falha(
        `insert into item_de_venda (comerciante_id, venda_id, produto_id, quantidade, preco_unitario_centavos, valor_total_centavos)
         values ($1, $2, $3, 1, 100, 100)`,
        [esquina, v!.id, p!.id],
      );
      expect(erro?.code).toBe("23503"); // foreign_key_violation
    });

    it("o banco recusa uma compra que usa fornecedor de outro comerciante", async () => {
      const [f] = await consultar<{ id: string }>(
        "select id from fornecedor where comerciante_id = $1 limit 1",
        [vilaNova],
      );
      const erro = await falha(
        `insert into compra (comerciante_id, fornecedor_id, data, total_centavos, soma_itens_centavos, origem, confianca)
         values ($1, $2, '2026-10-01', 100, 100, 'dono', 1)`,
        [esquina, f!.id],
      );
      expect(erro?.code).toBe("23503");
    });

    it("consultas filtradas por comerciante_id nunca devolvem linhas do outro", async () => {
      for (const tabela of ["produto", "venda", "compra", "transacao", "fornecedor", "historico_custo"]) {
        const linhas = await consultar<{ comerciante_id: string }>(
          `select distinct comerciante_id from ${tabela} where comerciante_id = $1`,
          [esquina],
        );
        expect(linhas.map((l) => l.comerciante_id)).toEqual([esquina]);
      }
    });
  });

  describe("histórico append-only (regra inviolável 10)", () => {
    it.each(["historico_custo", "vinculo_descricao_produto"])("%s não aceita UPDATE", async (tabela) => {
      const erro = await falha(`update ${tabela} set confianca = 0.1 where comerciante_id = $1`, [vilaNova]);
      expect(erro?.code).toBe("23001"); // restrict_violation
      expect(erro?.message).toContain("append-only");
    });

    it.each(["historico_custo", "vinculo_descricao_produto"])(
      "%s não aceita DELETE direto",
      async (tabela) => {
        const erro = await falha(`delete from ${tabela} where comerciante_id = $1`, [vilaNova]);
        expect(erro?.code).toBe("23001");
      },
    );

    it("a retenção pode apagar quando a transação declara a exclusão autorizada", async () => {
      const cliente = await pool.connect();
      try {
        await cliente.query("begin");
        await cliente.query("set local omnia.exclusao_autorizada = 'on'");
        const r = await cliente.query("delete from historico_custo where comerciante_id = $1", [esquina]);
        expect(r.rowCount).toBeGreaterThan(0);
      } finally {
        await cliente.query("rollback");
        cliente.release();
      }
    });

    it("a exclusão do lojista (LGPD) apaga o histórico em cascata", async () => {
      const [{ id }] = (await consultar<{ id: string }>(
        "insert into comerciante (nome) values ('Loja para excluir') returning id",
      )) as [{ id: string }];
      await pool.query("insert into fornecedor (comerciante_id, nome, origem) values ($1, 'F', 'dono')", [
        id,
      ]);
      await pool.query("insert into produto (comerciante_id, nome, origem) values ($1, 'P', 'dono')", [id]);
      const [f] = await consultar<{ id: string }>("select id from fornecedor where comerciante_id = $1", [
        id,
      ]);
      const [p] = await consultar<{ id: string }>("select id from produto where comerciante_id = $1", [id]);
      await pool.query(
        `insert into compra (comerciante_id, fornecedor_id, data, total_centavos, soma_itens_centavos, origem, confianca)
         values ($1, $2, '2026-10-01', 500, 500, 'dono', 1)`,
        [id, f!.id],
      );
      const [c] = await consultar<{ id: string }>("select id from compra where comerciante_id = $1", [id]);
      await pool.query(
        `insert into item_de_compra (comerciante_id, compra_id, produto_id, ordem, descricao_nota, quantidade, unidade,
                                     valor_unitario_centavos, valor_total_centavos, confianca, origem)
         values ($1, $2, $3, 1, 'P', 1, 'UN', 500, 500, 1, 'dono')`,
        [id, c!.id, p!.id],
      );
      const [i] = await consultar<{ id: string }>("select id from item_de_compra where comerciante_id = $1", [
        id,
      ]);
      await pool.query(
        `insert into historico_custo (comerciante_id, produto_id, fornecedor_id, data, custo_unitario_centavos, item_de_compra_id, origem, confianca)
         values ($1, $2, $3, '2026-10-01', 500, $4, 'dono', 1)`,
        [id, p!.id, f!.id, i!.id],
      );

      await pool.query("delete from comerciante where id = $1", [id]);
      for (const tabela of ["historico_custo", "item_de_compra", "compra", "produto", "fornecedor"]) {
        const [n] = await consultar<{ n: string }>(
          `select count(*) n from ${tabela} where comerciante_id = $1`,
          [id],
        );
        expect(Number(n!.n)).toBe(0);
      }
    });
  });

  describe("restrições de negócio", () => {
    it("aceita no máximo uma mensagem proativa enviada por dia (regra inviolável 9)", async () => {
      const inserir = (proativa: boolean, direcao: string, chave: string | null) =>
        falha(
          `insert into mensagem (comerciante_id, direcao, texto, proativa, data_envio, chave_idempotencia)
           values ($1, $2, 'oi', $3, '2030-01-01', $4)`,
          [esquina, direcao, proativa, chave],
        );
      expect(await inserir(true, "enviada", "esquina:2030-01-01")).toBeNull();
      expect((await inserir(true, "enviada", "outra-chave"))?.code).toBe("23505");
      // Resposta do dono e conversa dentro da janela não contam como proativa.
      expect(await inserir(false, "recebida", null)).toBeNull();
      expect(await inserir(false, "enviada", null)).toBeNull();
      await pool.query("delete from mensagem where comerciante_id = $1 and data_envio = '2030-01-01'", [
        esquina,
      ]);
    });

    it("o job diário é idempotente: a mesma chave de comerciante e data não grava duas vezes", async () => {
      const inserir = () =>
        falha(
          `insert into mensagem (comerciante_id, direcao, texto, data_envio, chave_idempotencia)
           values ($1, 'enviada', 'relatório', '2030-01-02', 'relatorio:2030-01-02')`,
          [esquina],
        );
      expect(await inserir()).toBeNull();
      expect((await inserir())?.code).toBe("23505");
      await pool.query("delete from mensagem where comerciante_id = $1 and data_envio = '2030-01-02'", [
        esquina,
      ]);
    });

    it("não duplica o mesmo alerta no mesmo dia", async () => {
      const inserir = () =>
        falha(
          `insert into alerta (comerciante_id, tipo, prioridade, data_referencia, chave, metricas_apoio)
           values ($1, 'estoque_parado', 2, '2030-01-03', 'P99', '{}')`,
          [esquina],
        );
      expect(await inserir()).toBeNull();
      expect((await inserir())?.code).toBe("23505");
      await pool.query("delete from alerta where comerciante_id = $1 and data_referencia = '2030-01-03'", [
        esquina,
      ]);
    });

    describe("vínculo com a execução do agente", () => {
      const novaExecucao = async (comercianteId: string) => {
        const [e] = await consultar<{ id: string }>(
          `insert into execucao_agente (comerciante_id, gatilho, entrada, modelo, versao_prompt, resultado,
             mensagem_final, iteracoes, bloqueios_verificador, tokens_entrada, tokens_saida,
             custo_estimado_microdolares, latencia_ms)
           values ($1, 'mensagem_dono', 'oi', 'modelo', 'v1', 'aprovada', 'ok', 1, 0, 1, 1, 1, 1) returning id`,
          [comercianteId],
        );
        return e!.id;
      };

      it("o banco recusa chamada, alerta e mensagem apontando para execução de outro comerciante", async () => {
        const execucao = await novaExecucao(vilaNova);
        const chamada = await falha(
          `insert into chamada_ferramenta (execucao_id, comerciante_id, ordem, ferramenta, entrada, latencia_ms)
           values ($1, $2, 1, 'get_product_margin', '{}', 1)`,
          [execucao, esquina],
        );
        const alerta = await falha(
          `insert into alerta (comerciante_id, tipo, prioridade, data_referencia, chave, metricas_apoio, execucao_id)
           values ($1, 'estoque_parado', 2, '2030-01-04', 'P98', '{}', $2)`,
          [esquina, execucao],
        );
        const msg = await falha(
          `insert into mensagem (comerciante_id, direcao, texto, data_envio, execucao_id)
           values ($1, 'enviada', 'oi', '2030-01-04', $2)`,
          [esquina, execucao],
        );
        expect([chamada?.code, alerta?.code, msg?.code]).toEqual(["23503", "23503", "23503"]);
        await pool.query("delete from execucao_agente where id = $1", [execucao]);
      });

      it("apagar a execução solta alerta e mensagem do mesmo comerciante sem perder o comerciante_id", async () => {
        const execucao = await novaExecucao(esquina);
        await pool.query(
          `insert into mensagem (comerciante_id, direcao, texto, data_envio, execucao_id)
           values ($1, 'enviada', 'vinculada', '2030-01-05', $2)`,
          [esquina, execucao],
        );
        await pool.query("delete from execucao_agente where id = $1", [execucao]);
        const linhas = await consultar<{ comerciante_id: string; execucao_id: string | null }>(
          "select comerciante_id, execucao_id from mensagem where texto = 'vinculada' and comerciante_id = $1",
          [esquina],
        );
        expect(linhas).toEqual([{ comerciante_id: esquina, execucao_id: null }]);
        await pool.query("delete from mensagem where texto = 'vinculada' and comerciante_id = $1", [esquina]);
      });
    });

    it("não grava duas vezes a mensagem com o mesmo id do canal (reentrega do webhook)", async () => {
      const inserir = (idExterno: string | null) =>
        falha(
          `insert into mensagem (comerciante_id, direcao, texto, data_envio, id_externo)
           values ($1, 'recebida', 'oi', '2030-01-06', $2)`,
          [esquina, idExterno],
        );
      expect(await inserir("wamid.A")).toBeNull();
      expect((await inserir("wamid.A"))?.code).toBe("23505");
      // Sem id do canal, não há o que deduplicar.
      expect(await inserir(null)).toBeNull();
      expect(await inserir(null)).toBeNull();
      await pool.query("delete from mensagem where comerciante_id = $1 and data_envio = '2030-01-06'", [
        esquina,
      ]);
    });

    it("recusa confiança fora de 0 a 1, valor bancário zero e quantidade não positiva", async () => {
      const [c] = await consultar<{ id: string }>("select id from conta where comerciante_id = $1", [
        esquina,
      ]);
      const confianca = await falha(
        `insert into fornecedor (comerciante_id, nome, origem, confianca) values ($1, 'X', 'dono', 1.5)`,
        [esquina],
      );
      expect(confianca?.code).toBe("23514"); // check_violation
      const valor = await falha(
        `insert into transacao (comerciante_id, conta_id, data, valor_centavos, tipo, descricao)
         values ($1, $2, '2026-10-01', 0, 'saida', 'x')`,
        [esquina, c!.id],
      );
      expect(valor?.code).toBe("23514");
    });

    it("a busca por similaridade de texto (pg_trgm) acha o produto pelo nome aproximado", async () => {
      const linhas = await consultar<{ nome: string }>(
        `select nome from produto where comerciante_id = $1 and nome % 'Arroz branco tipo 1 5 kg'
          order by similarity(nome, 'Arroz branco tipo 1 5 kg') desc limit 1`,
        [vilaNova],
      );
      expect(linhas[0]?.nome).toBe("Arroz branco tipo 1 5kg");
    });
  });
});
