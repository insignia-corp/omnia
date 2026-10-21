import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * Modelo de dados (issue #21). Diagrama e decisões em docs/modelo-de-dados.md.
 *
 * Regras que valem para todas as tabelas:
 * - dinheiro em centavos inteiros (`bigint`, `mode: "number"`), nunca ponto flutuante;
 * - `comerciante_id` em toda tabela com dado do lojista, com índice;
 * - tabela filha aponta para a mãe por chave composta (id, comerciante_id), então o banco
 *   recusa um vínculo entre dados de lojistas diferentes (isolamento, regra inviolável 3);
 * - todo dado extraído ou informado carrega `origem` e `confianca` (regra inviolável 4);
 * - histórico de custo e vínculos nota-produto são append-only (regra inviolável 10, ver a
 *   migração `historico_append_only`); só a exclusão do lojista (LGPD) apaga, em cascata.
 */

const criadoEm = () => timestamp("criado_em", { withTimezone: true }).notNull().defaultNow();

export const comerciante = pgTable(
  "comerciante",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nome: text("nome").notNull(),
    telefoneWhatsapp: text("telefone_whatsapp").unique(),
    tipoComercio: text("tipo_comercio").notNull().default("mercadinho"),
    /** Meta de margem informada pelo dono, em pontos-base (2500 = 25%). Configuração do próprio lojista. */
    margemMetaBps: integer("margem_meta_bps").notNull().default(2500),
    criadoEm: criadoEm(),
  },
  (t) => [check("comerciante_margem_meta_faixa", sql`${t.margemMetaBps} between 0 and 10000`)],
);

/** Todo dado do lojista aponta para o comerciante; apagar o comerciante apaga tudo (LGPD). */
const comercianteId = () =>
  uuid("comerciante_id")
    .notNull()
    .references(() => comerciante.id, { onDelete: "cascade" });

const confiancaNaFaixa = (nome: string, coluna: AnyPgColumn) => check(nome, sql`${coluna} between 0 and 1`);

export const gatilhoExecucao = pgEnum("gatilho_execucao", [
  "relatorio_diario",
  "mensagem_dono",
  "nota_processada",
  "extracao_nota",
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
  (t) => [
    unique("execucao_agente_id_comerciante_uq").on(t.id, t.comercianteId),
    index("execucao_agente_comerciante_idx").on(t.comercianteId, t.criadoEm),
  ],
);

/** Cada chamada de ferramenta feita pelo agente, em ordem (tela de bastidores e auditoria). */
export const chamadaFerramenta = pgTable(
  "chamada_ferramenta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    execucaoId: uuid("execucao_id").notNull(),
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
  (t) => [
    // Chave composta: a chamada só pode apontar para execução do mesmo comerciante.
    foreignKey({
      name: "chamada_ferramenta_execucao_fk",
      columns: [t.execucaoId, t.comercianteId],
      foreignColumns: [execucaoAgente.id, execucaoAgente.comercianteId],
    }).onDelete("cascade"),
    index("chamada_ferramenta_execucao_idx").on(t.execucaoId, t.ordem),
  ],
);

/* ----------------------------------------------------------------------------------------------
 * Enums
 * -------------------------------------------------------------------------------------------- */

/** De onde veio o dado (regra inviolável 4). */
export const origemDado = pgEnum("origem_dado", ["foto_nota", "nfe", "planilha", "banco", "dono"]);
export const tipoDocumento = pgEnum("tipo_documento", ["foto_nota", "nfe", "planilha"]);
export const statusExtracao = pgEnum("status_extracao", [
  "pendente",
  "processando",
  "extraido",
  "revisao",
  "falha",
]);
export const tipoTransacao = pgEnum("tipo_transacao", ["entrada", "saida"]);
export const statusConta = pgEnum("status_conta", ["ativo", "revogado", "expirado", "erro"]);
export const tipoConsentimento = pgEnum("tipo_consentimento", ["banco", "notas"]);
export const metodoVinculo = pgEnum("metodo_vinculo", ["codigo_barras", "similaridade", "modelo", "dono"]);
export const tipoAlerta = pgEnum("tipo_alerta", [
  "reajuste_de_custo",
  "margem_abaixo_da_meta",
  "espaco_para_subir_preco",
  "giro_em_alta",
  "estoque_parado",
  "ticket_medio_em_queda",
  "gasto_fora_do_padrao",
]);
export const statusAlerta = pgEnum("status_alerta", ["candidato", "enviado", "descartado"]);
export const direcaoMensagem = pgEnum("direcao_mensagem", ["enviada", "recebida"]);
export const canalMensagem = pgEnum("canal_mensagem", ["web", "whatsapp"]);
export const categoriaTemplate = pgEnum("categoria_template", [
  "utilidade",
  "marketing",
  "servico",
  "autenticacao",
]);
export const tipoPergunta = pgEnum("tipo_pergunta", [
  "confirmar_item",
  "confirmar_vinculo",
  "confirmar_documento",
  "informar_custo",
  "confirmar_acao",
]);
export const statusPergunta = pgEnum("status_pergunta", ["pendente", "respondida", "expirada", "cancelada"]);

/* ----------------------------------------------------------------------------------------------
 * Cadastro: consentimento, conta e transações bancárias
 * -------------------------------------------------------------------------------------------- */

/** Registro do que foi autorizado, quando e como revogar (LGPD). Uma linha por concessão. */
export const consentimento = pgTable(
  "consentimento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    tipo: tipoConsentimento("tipo").notNull(),
    versaoTermo: text("versao_termo").notNull(),
    concedidoEm: timestamp("concedido_em", { withTimezone: true }).notNull().defaultNow(),
    revogadoEm: timestamp("revogado_em", { withTimezone: true }),
  },
  (t) => [index("consentimento_comerciante_idx").on(t.comercianteId, t.tipo)],
);

export const conta = pgTable(
  "conta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    instituicao: text("instituicao").notNull(),
    /** Identificador da conexão no agregador (Pluggy). Nunca credenciais bancárias. */
    conexaoId: text("conexao_id"),
    tipo: text("tipo").notNull().default("corrente"),
    status: statusConta("status").notNull().default("ativo"),
    /** Saldo na data em que a conta entrou no sistema; o saldo de um dia soma as transações a partir daí. */
    saldoInicialCentavos: bigint("saldo_inicial_centavos", { mode: "number" }),
    saldoInicialEm: date("saldo_inicial_em", { mode: "string" }),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("conta_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("conta_conexao_uq").on(t.comercianteId, t.conexaoId),
    index("conta_comerciante_idx").on(t.comercianteId),
  ],
);

export const transacao = pgTable(
  "transacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    contaId: uuid("conta_id").notNull(),
    data: date("data", { mode: "string" }).notNull(),
    valorCentavos: bigint("valor_centavos", { mode: "number" }).notNull(),
    tipo: tipoTransacao("tipo").notNull(),
    descricao: text("descricao").notNull(),
    categoria: text("categoria"),
    /** Id da transação no agregador, para importar sem duplicar. */
    idExterno: text("id_externo"),
    origem: origemDado("origem").notNull().default("banco"),
    confianca: real("confianca").notNull().default(1),
    criadoEm: criadoEm(),
  },
  (t) => [
    foreignKey({
      name: "transacao_conta_fk",
      columns: [t.contaId, t.comercianteId],
      foreignColumns: [conta.id, conta.comercianteId],
    }),
    unique("transacao_id_externo_uq").on(t.contaId, t.idExterno),
    index("transacao_comerciante_data_idx").on(t.comercianteId, t.data),
    check("transacao_valor_positivo", sql`${t.valorCentavos} > 0`),
    confiancaNaFaixa("transacao_confianca_faixa", t.confianca),
  ],
);

/* ----------------------------------------------------------------------------------------------
 * Catálogo: fornecedor e produto
 * -------------------------------------------------------------------------------------------- */

export const fornecedor = pgTable(
  "fornecedor",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    nome: text("nome").notNull(),
    /** Só dígitos. */
    cnpj: text("cnpj"),
    origem: origemDado("origem").notNull(),
    confianca: real("confianca").notNull().default(1),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("fornecedor_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("fornecedor_cnpj_uq").on(t.comercianteId, t.cnpj),
    index("fornecedor_comerciante_idx").on(t.comercianteId),
    confiancaNaFaixa("fornecedor_confianca_faixa", t.confianca),
  ],
);

export const produto = pgTable(
  "produto",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    nome: text("nome").notNull(),
    codigoBarras: text("codigo_barras"),
    sku: text("sku"),
    unidade: text("unidade").notNull().default("un"),
    categoria: text("categoria"),
    /** Preço-meta definido pelo dono. A única escrita do agente, e só após confirmação (regra 7). */
    precoMetaCentavos: bigint("preco_meta_centavos", { mode: "number" }),
    /** Meta de margem própria do produto; quando nula vale a do comerciante. */
    margemMetaBps: integer("margem_meta_bps"),
    origem: origemDado("origem").notNull(),
    confianca: real("confianca").notNull().default(1),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("produto_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("produto_codigo_barras_uq").on(t.comercianteId, t.codigoBarras),
    unique("produto_sku_uq").on(t.comercianteId, t.sku),
    index("produto_comerciante_idx").on(t.comercianteId),
    // Vínculo por similaridade de texto (pg_trgm), segundo passo do vínculo nota-produto.
    index("produto_nome_trgm_idx").using("gin", t.nome.op("gin_trgm_ops")),
    confiancaNaFaixa("produto_confianca_faixa", t.confianca),
  ],
);

/* ----------------------------------------------------------------------------------------------
 * Documentos e compras
 * -------------------------------------------------------------------------------------------- */

export const documento = pgTable(
  "documento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    tipo: tipoDocumento("tipo").notNull(),
    /** Caminho no armazenamento de arquivos (issue #22), relativo à raiz dele. */
    arquivoCaminho: text("arquivo_caminho").notNull(),
    /** SHA-256 do arquivo: o mesmo arquivo enviado duas vezes não vira dois documentos. */
    arquivoHash: text("arquivo_hash").notNull(),
    statusExtracao: statusExtracao("status_extracao").notNull().default("pendente"),
    confiancaMedia: real("confianca_media"),
    /** Saída do modelo já validada pelo esquema Zod, guardada para auditoria. */
    extracaoJson: jsonb("extracao_json"),
    /** Divergências achadas pelas conferências em código (soma, CNPJ, data...), uma por item da lista. */
    motivosValidacao: jsonb("motivos_validacao")
      .notNull()
      .default(sql`'[]'::jsonb`),
    erro: text("erro"),
    criadoEm: criadoEm(),
    processadoEm: timestamp("processado_em", { withTimezone: true }),
  },
  (t) => [
    unique("documento_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("documento_hash_uq").on(t.comercianteId, t.arquivoHash),
    index("documento_comerciante_status_idx").on(t.comercianteId, t.statusExtracao),
    check(
      "documento_confianca_faixa",
      sql`${t.confiancaMedia} is null or ${t.confiancaMedia} between 0 and 1`,
    ),
  ],
);

export const compra = pgTable(
  "compra",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    documentoId: uuid("documento_id"),
    fornecedorId: uuid("fornecedor_id").notNull(),
    data: date("data", { mode: "string" }).notNull(),
    numeroDocumento: text("numero_documento"),
    /** Total impresso na nota. */
    totalCentavos: bigint("total_centavos", { mode: "number" }).notNull(),
    /** Soma dos itens, calculada em código. Diferente do total reduz a confiança. */
    somaItensCentavos: bigint("soma_itens_centavos", { mode: "number" }).notNull(),
    origem: origemDado("origem").notNull(),
    confianca: real("confianca").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("compra_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("compra_documento_uq").on(t.documentoId),
    foreignKey({
      name: "compra_documento_fk",
      columns: [t.documentoId, t.comercianteId],
      foreignColumns: [documento.id, documento.comercianteId],
    }),
    foreignKey({
      name: "compra_fornecedor_fk",
      columns: [t.fornecedorId, t.comercianteId],
      foreignColumns: [fornecedor.id, fornecedor.comercianteId],
    }),
    index("compra_comerciante_data_idx").on(t.comercianteId, t.data),
    index("compra_fornecedor_idx").on(t.comercianteId, t.fornecedorId),
    confiancaNaFaixa("compra_confianca_faixa", t.confianca),
  ],
);

export const itemDeCompra = pgTable(
  "item_de_compra",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    compraId: uuid("compra_id").notNull(),
    /** Nulo enquanto a descrição da nota não foi ligada a um produto. */
    produtoId: uuid("produto_id"),
    ordem: smallint("ordem").notNull(),
    descricaoNota: text("descricao_nota").notNull(),
    quantidade: numeric("quantidade", { precision: 14, scale: 3, mode: "number" }).notNull(),
    unidade: text("unidade").notNull(),
    valorUnitarioCentavos: bigint("valor_unitario_centavos", { mode: "number" }).notNull(),
    valorTotalCentavos: bigint("valor_total_centavos", { mode: "number" }).notNull(),
    confianca: real("confianca").notNull(),
    origem: origemDado("origem").notNull(),
    /** Verdadeiro quando a confiança ficou abaixo do limite e há pergunta ao dono. */
    revisaoPendente: boolean("revisao_pendente").notNull().default(false),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("item_de_compra_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("item_de_compra_ordem_uq").on(t.compraId, t.ordem),
    foreignKey({
      name: "item_de_compra_compra_fk",
      columns: [t.compraId, t.comercianteId],
      foreignColumns: [compra.id, compra.comercianteId],
    }).onDelete("cascade"),
    foreignKey({
      name: "item_de_compra_produto_fk",
      columns: [t.produtoId, t.comercianteId],
      foreignColumns: [produto.id, produto.comercianteId],
    }),
    index("item_de_compra_produto_idx").on(t.comercianteId, t.produtoId),
    check("item_de_compra_quantidade_positiva", sql`${t.quantidade} > 0`),
    confiancaNaFaixa("item_de_compra_confianca_faixa", t.confianca),
  ],
);

/**
 * Vínculo confirmado entre a descrição impressa na nota e um produto. Append-only: trocar o
 * vínculo insere uma linha nova e a vigente é a mais recente da chave. É ativo próprio (edital
 * 9.4), por isso o histórico nunca é sobrescrito.
 */
export const vinculoDescricaoProduto = pgTable(
  "vinculo_descricao_produto",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    /** Opcional: a mesma descrição pode significar produtos diferentes em fornecedores diferentes. */
    fornecedorId: uuid("fornecedor_id"),
    /** Descrição em maiúsculas, sem acento e com espaços normalizados. */
    descricaoNormalizada: text("descricao_normalizada").notNull(),
    produtoId: uuid("produto_id").notNull(),
    metodo: metodoVinculo("metodo").notNull(),
    confianca: real("confianca").notNull(),
    confirmadoPeloDono: boolean("confirmado_pelo_dono").notNull().default(false),
    confirmadoEm: timestamp("confirmado_em", { withTimezone: true }),
    criadoEm: criadoEm(),
  },
  (t) => [
    foreignKey({
      name: "vinculo_fornecedor_fk",
      columns: [t.fornecedorId, t.comercianteId],
      foreignColumns: [fornecedor.id, fornecedor.comercianteId],
    }),
    foreignKey({
      name: "vinculo_produto_fk",
      columns: [t.produtoId, t.comercianteId],
      foreignColumns: [produto.id, produto.comercianteId],
    }),
    index("vinculo_busca_idx").on(t.comercianteId, t.descricaoNormalizada, t.criadoEm),
    index("vinculo_descricao_trgm_idx").using("gin", t.descricaoNormalizada.op("gin_trgm_ops")),
    confiancaNaFaixa("vinculo_confianca_faixa", t.confianca),
  ],
);

/**
 * Histórico de custo por produto, fornecedor e data. Append-only: nunca atualizada nem apagada
 * (só a exclusão do lojista apaga). Uma linha por leitura do item; quando o dono corrige o custo
 * entra uma linha nova e vale a mais recente do item. Alimenta margem e variação de
 * custo, e é o ativo próprio de dados do projeto.
 */
export const historicoCusto = pgTable(
  "historico_custo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    produtoId: uuid("produto_id").notNull(),
    fornecedorId: uuid("fornecedor_id").notNull(),
    data: date("data", { mode: "string" }).notNull(),
    custoUnitarioCentavos: bigint("custo_unitario_centavos", { mode: "number" }).notNull(),
    itemDeCompraId: uuid("item_de_compra_id").notNull(),
    origem: origemDado("origem").notNull(),
    confianca: real("confianca").notNull(),
    criadoEm: criadoEm(),
  },
  (t) => [
    foreignKey({
      name: "historico_custo_produto_fk",
      columns: [t.produtoId, t.comercianteId],
      foreignColumns: [produto.id, produto.comercianteId],
    }),
    foreignKey({
      name: "historico_custo_fornecedor_fk",
      columns: [t.fornecedorId, t.comercianteId],
      foreignColumns: [fornecedor.id, fornecedor.comercianteId],
    }),
    foreignKey({
      name: "historico_custo_item_fk",
      columns: [t.itemDeCompraId, t.comercianteId],
      foreignColumns: [itemDeCompra.id, itemDeCompra.comercianteId],
    }),
    index("historico_custo_busca_idx").on(t.comercianteId, t.produtoId, t.fornecedorId, t.data),
    // Várias linhas por item: a correção do dono insere uma nova e vale a mais recente.
    index("historico_custo_item_idx").on(t.itemDeCompraId, t.criadoEm),
    check("historico_custo_nao_negativo", sql`${t.custoUnitarioCentavos} >= 0`),
    confiancaNaFaixa("historico_custo_confianca_faixa", t.confianca),
  ],
);

/**
 * Cada preço-meta que o dono confirmou para um produto (issue #104). `produto.preco_meta_centavos`
 * guarda o valor vigente; aqui fica o histórico, append-only (regra inviolável 10): o anterior não
 * é apagado. A confirmação do dono que autorizou a mudança fica em `pergunta_dono` (`confirmar_acao`).
 */
export const historicoPrecoMeta = pgTable(
  "historico_preco_meta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    produtoId: uuid("produto_id").notNull(),
    precoMetaCentavos: bigint("preco_meta_centavos", { mode: "number" }).notNull(),
    /** Valor vigente antes desta mudança; nulo na primeira meta do produto. */
    anteriorCentavos: bigint("anterior_centavos", { mode: "number" }),
    origem: origemDado("origem").notNull().default("dono"),
    /** Valor confirmado pelo dono: confiança 1, como as outras linhas de origem `dono`. */
    confianca: real("confianca").notNull().default(1),
    criadoEm: criadoEm(),
  },
  (t) => [
    foreignKey({
      name: "historico_preco_meta_produto_fk",
      columns: [t.produtoId, t.comercianteId],
      foreignColumns: [produto.id, produto.comercianteId],
    }),
    index("historico_preco_meta_busca_idx").on(t.comercianteId, t.produtoId, t.criadoEm),
    check("historico_preco_meta_positivo", sql`${t.precoMetaCentavos} > 0`),
    confiancaNaFaixa("historico_preco_meta_confianca_faixa", t.confianca),
  ],
);

/* ----------------------------------------------------------------------------------------------
 * Vendas
 * -------------------------------------------------------------------------------------------- */

/** Mapeamento de colunas de uma planilha de vendas, confirmado pelo dono uma única vez. */
export const mapeamentoPlanilha = pgTable(
  "mapeamento_planilha",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    /** Cabeçalhos normalizados e ordenados, unidos: identifica o "formato" da planilha. */
    assinatura: text("assinatura").notNull(),
    /** Campo do sistema (data, produto, quantidade...) para o nome da coluna na planilha. */
    mapeamento: jsonb("mapeamento").notNull(),
    confirmadoPeloDono: boolean("confirmado_pelo_dono").notNull().default(false),
    criadoEm: criadoEm(),
  },
  (t) => [unique("mapeamento_planilha_assinatura_uq").on(t.comercianteId, t.assinatura)],
);

export const venda = pgTable(
  "venda",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    documentoId: uuid("documento_id"),
    data: date("data", { mode: "string" }).notNull(),
    hora: time("hora"),
    /** Número do cupom no PDV ou na planilha; com a data, identifica a venda ao reimportar. */
    numeroCupom: text("numero_cupom").notNull(),
    totalCentavos: bigint("total_centavos", { mode: "number" }).notNull(),
    origem: origemDado("origem").notNull().default("planilha"),
    confianca: real("confianca").notNull().default(1),
    criadoEm: criadoEm(),
  },
  (t) => [
    unique("venda_id_comerciante_uq").on(t.id, t.comercianteId),
    unique("venda_cupom_uq").on(t.comercianteId, t.data, t.numeroCupom),
    foreignKey({
      name: "venda_documento_fk",
      columns: [t.documentoId, t.comercianteId],
      foreignColumns: [documento.id, documento.comercianteId],
    }),
    index("venda_comerciante_data_idx").on(t.comercianteId, t.data),
    confiancaNaFaixa("venda_confianca_faixa", t.confianca),
  ],
);

export const itemDeVenda = pgTable(
  "item_de_venda",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    vendaId: uuid("venda_id").notNull(),
    produtoId: uuid("produto_id").notNull(),
    quantidade: numeric("quantidade", { precision: 14, scale: 3, mode: "number" }).notNull(),
    precoUnitarioCentavos: bigint("preco_unitario_centavos", { mode: "number" }).notNull(),
    valorTotalCentavos: bigint("valor_total_centavos", { mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "item_de_venda_venda_fk",
      columns: [t.vendaId, t.comercianteId],
      foreignColumns: [venda.id, venda.comercianteId],
    }).onDelete("cascade"),
    foreignKey({
      name: "item_de_venda_produto_fk",
      columns: [t.produtoId, t.comercianteId],
      foreignColumns: [produto.id, produto.comercianteId],
    }),
    index("item_de_venda_venda_idx").on(t.vendaId),
    index("item_de_venda_produto_idx").on(t.comercianteId, t.produtoId),
    check("item_de_venda_quantidade_positiva", sql`${t.quantidade} > 0`),
  ],
);

/* ----------------------------------------------------------------------------------------------
 * Alertas, mensagens e perguntas ao dono
 * -------------------------------------------------------------------------------------------- */

export const alerta = pgTable(
  "alerta",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    tipo: tipoAlerta("tipo").notNull(),
    /** 1 = mais importante, 3 = menos. */
    prioridade: smallint("prioridade").notNull(),
    status: statusAlerta("status").notNull().default("candidato"),
    dataReferencia: date("data_referencia", { mode: "string" }).notNull(),
    /** Distingue alertas do mesmo tipo no mesmo dia (ex.: o id do produto). Com a data, dá idempotência. */
    chave: text("chave").notNull(),
    produtoId: uuid("produto_id"),
    fornecedorId: uuid("fornecedor_id"),
    /** Números calculados pelas funções de métrica que sustentam o alerta. */
    metricasApoio: jsonb("metricas_apoio").notNull(),
    /** Por que o agente enviou ou descartou o candidato (log de decisão). */
    justificativa: text("justificativa"),
    execucaoId: uuid("execucao_id"),
    criadoEm: criadoEm(),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }),
  },
  (t) => [
    unique("alerta_idempotencia_uq").on(t.comercianteId, t.tipo, t.chave, t.dataReferencia),
    foreignKey({
      name: "alerta_produto_fk",
      columns: [t.produtoId, t.comercianteId],
      foreignColumns: [produto.id, produto.comercianteId],
    }),
    foreignKey({
      name: "alerta_fornecedor_fk",
      columns: [t.fornecedorId, t.comercianteId],
      foreignColumns: [fornecedor.id, fornecedor.comercianteId],
    }),
    // Na migração, o SET NULL vale só para execucao_id (comerciante_id é NOT NULL).
    foreignKey({
      name: "alerta_execucao_fk",
      columns: [t.execucaoId, t.comercianteId],
      foreignColumns: [execucaoAgente.id, execucaoAgente.comercianteId],
    }).onDelete("set null"),
    index("alerta_comerciante_data_idx").on(t.comercianteId, t.dataReferencia, t.status),
    check("alerta_prioridade_faixa", sql`${t.prioridade} between 1 and 3`),
  ],
);

export const mensagem = pgTable(
  "mensagem",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    direcao: direcaoMensagem("direcao").notNull(),
    canal: canalMensagem("canal").notNull().default("web"),
    /** Categoria do template da Meta; nula em texto livre dentro da janela de 24 horas. */
    categoriaTemplate: categoriaTemplate("categoria_template"),
    texto: text("texto").notNull(),
    /** Custo estimado em micro-dólares (USD x 1e6), inteiro. */
    custoEstimadoMicrodolares: bigint("custo_estimado_microdolares", { mode: "number" }).notNull().default(0),
    /** Mensagem iniciada pelo sistema (relatório diário). No máximo uma por dia (regra inviolável 9). */
    proativa: boolean("proativa").notNull().default(false),
    dataEnvio: date("data_envio", { mode: "string" }).notNull(),
    /** Chave de idempotência do job (comerciante + data). */
    chaveIdempotencia: text("chave_idempotencia"),
    idExterno: text("id_externo"),
    execucaoId: uuid("execucao_id"),
    criadoEm: criadoEm(),
  },
  (t) => [
    foreignKey({
      name: "mensagem_execucao_fk",
      columns: [t.execucaoId, t.comercianteId],
      foreignColumns: [execucaoAgente.id, execucaoAgente.comercianteId],
    }).onDelete("set null"),
    // Redelivery do webhook: o mesmo id do canal não entra duas vezes (idempotência de entrada).
    uniqueIndex("mensagem_id_externo_uq")
      .on(t.comercianteId, t.canal, t.idExterno)
      .where(sql`${t.idExterno} is not null`),
    unique("mensagem_idempotencia_uq").on(t.comercianteId, t.chaveIdempotencia),
    uniqueIndex("mensagem_uma_proativa_por_dia_uq")
      .on(t.comercianteId, t.dataEnvio)
      .where(sql`${t.proativa} and ${t.direcao} = 'enviada'`),
    index("mensagem_comerciante_idx").on(t.comercianteId, t.criadoEm),
  ],
);

/** Pergunta do agente ao dono e a resposta dele. Estado em banco, não em memória (regra 11). */
export const perguntaDono = pgTable(
  "pergunta_dono",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    comercianteId: comercianteId(),
    tipo: tipoPergunta("tipo").notNull(),
    status: statusPergunta("status").notNull().default("pendente"),
    pergunta: text("pergunta").notNull(),
    contexto: jsonb("contexto")
      .notNull()
      .default(sql`'{}'::jsonb`),
    resposta: text("resposta"),
    itemDeCompraId: uuid("item_de_compra_id"),
    criadoEm: criadoEm(),
    respondidaEm: timestamp("respondida_em", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "pergunta_dono_item_fk",
      columns: [t.itemDeCompraId, t.comercianteId],
      foreignColumns: [itemDeCompra.id, itemDeCompra.comercianteId],
    }),
    index("pergunta_dono_status_idx").on(t.comercianteId, t.status),
  ],
);
