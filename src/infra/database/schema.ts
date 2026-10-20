import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Schema inicial. O modelo de dados completo (compras, vendas, produtos, alertas...) é a
 * issue #21. Regras: dinheiro em centavos inteiros e `comerciante_id` em toda tabela com
 * dado do lojista.
 */

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();

export const comerciante = pgTable("comerciante", {
  id: uuid("id").primaryKey().defaultRandom(),
  nome: text("nome").notNull(),
  telefoneWhatsapp: text("telefone_whatsapp").unique(),
  tipoComercio: text("tipo_comercio").notNull().default("mercadinho"),
  criadoEm: criadoEm(),
});

export const gatilhoExecucao = pgEnum("gatilho_execucao", [
  "relatorio_diario",
  "mensagem_dono",
  "nota_processada",
]);
export const resultadoExecucao = pgEnum("resultado_execucao", [
  "aprovada",
  "fallback_verificador",
  "fallback_erro",
  "recusa_modelo",
]);

/** Uma execução do agente (LLMOps, edital 9.4). */
export const execucaoAgente = pgTable(
  "execucao_agente",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: uuid("comerciante_id")
      .notNull()
      .references(() => comerciante.id, { onDelete: "cascade" }),
    gatilho: gatilhoExecucao("gatilho").notNull(),
    entrada: text("entrada").notNull(),
    modelo: text("modelo").notNull(),
    versaoPrompt: text("versao_prompt").notNull(),
    resultado: resultadoExecucao("resultado").notNull(),
    mensagemFinal: text("mensagem_final").notNull(),
    iteracoes: smallint("iteracoes").notNull(),
    bloqueiosVerificador: smallint("bloqueios_verificador").notNull(),
    /** Números barrados pelo verificador em cada tentativa, para auditoria. */
    detalhesVerificador: jsonb("detalhes_verificador")
      .notNull()
      .default(sql`'[]'::jsonb`),
    tokensEntrada: integer("tokens_entrada").notNull(),
    tokensSaida: integer("tokens_saida").notNull(),
    tokensCacheLeitura: integer("tokens_cache_leitura").notNull().default(0),
    /** Custo estimado em micro-dólares (USD x 1e6), inteiro. */
    custoEstimadoMicrodolares: bigint("custo_estimado_microdolares", { mode: "number" }).notNull(),
    latenciaMs: integer("latencia_ms").notNull(),
    erro: text("erro"),
    criadoEm: criadoEm(),
  },
  (t) => [index("execucao_agente_comerciante_idx").on(t.comercianteId, t.criadoEm)],
);

/** Cada chamada de ferramenta feita pelo agente, em ordem (tela de bastidores e auditoria). */
export const chamadaFerramenta = pgTable(
  "chamada_ferramenta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    execucaoId: uuid("execucao_id")
      .notNull()
      .references(() => execucaoAgente.id, { onDelete: "cascade" }),
    comercianteId: uuid("comerciante_id")
      .notNull()
      .references(() => comerciante.id, { onDelete: "cascade" }),
    ordem: smallint("ordem").notNull(),
    ferramenta: text("ferramenta").notNull(),
    entrada: jsonb("entrada").notNull(),
    saida: jsonb("saida"),
    erro: text("erro"),
    menorConfianca: real("menor_confianca"),
    latenciaMs: integer("latencia_ms").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [index("chamada_ferramenta_execucao_idx").on(t.execucaoId, t.ordem)],
);
