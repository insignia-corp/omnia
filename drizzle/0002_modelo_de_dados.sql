CREATE TYPE "public"."canal_mensagem" AS ENUM('web', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."categoria_template" AS ENUM('utilidade', 'marketing', 'servico', 'autenticacao');--> statement-breakpoint
CREATE TYPE "public"."direcao_mensagem" AS ENUM('enviada', 'recebida');--> statement-breakpoint
CREATE TYPE "public"."metodo_vinculo" AS ENUM('codigo_barras', 'similaridade', 'modelo', 'dono');--> statement-breakpoint
CREATE TYPE "public"."origem_dado" AS ENUM('foto_nota', 'nfe', 'planilha', 'banco', 'dono');--> statement-breakpoint
CREATE TYPE "public"."status_alerta" AS ENUM('candidato', 'enviado', 'descartado');--> statement-breakpoint
CREATE TYPE "public"."status_conta" AS ENUM('ativo', 'revogado', 'expirado', 'erro');--> statement-breakpoint
CREATE TYPE "public"."status_extracao" AS ENUM('pendente', 'processando', 'extraido', 'revisao', 'falha');--> statement-breakpoint
CREATE TYPE "public"."status_pergunta" AS ENUM('pendente', 'respondida', 'expirada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."tipo_alerta" AS ENUM('reajuste_de_custo', 'margem_abaixo_da_meta', 'espaco_para_subir_preco', 'giro_em_alta', 'estoque_parado', 'ticket_medio_em_queda', 'gasto_fora_do_padrao');--> statement-breakpoint
CREATE TYPE "public"."tipo_consentimento" AS ENUM('banco', 'notas');--> statement-breakpoint
CREATE TYPE "public"."tipo_documento" AS ENUM('foto_nota', 'nfe', 'planilha');--> statement-breakpoint
CREATE TYPE "public"."tipo_pergunta" AS ENUM('confirmar_item', 'confirmar_vinculo', 'informar_custo', 'confirmar_acao');--> statement-breakpoint
CREATE TYPE "public"."tipo_transacao" AS ENUM('entrada', 'saida');--> statement-breakpoint
CREATE TABLE "alerta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"tipo" "tipo_alerta" NOT NULL,
	"prioridade" smallint NOT NULL,
	"status" "status_alerta" DEFAULT 'candidato' NOT NULL,
	"data_referencia" date NOT NULL,
	"chave" text NOT NULL,
	"produto_id" uuid,
	"fornecedor_id" uuid,
	"metricas_apoio" jsonb NOT NULL,
	"justificativa" text,
	"execucao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"enviado_em" timestamp with time zone,
	CONSTRAINT "alerta_idempotencia_uq" UNIQUE("comerciante_id","tipo","chave","data_referencia"),
	CONSTRAINT "alerta_prioridade_faixa" CHECK ("alerta"."prioridade" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"documento_id" uuid,
	"fornecedor_id" uuid NOT NULL,
	"data" date NOT NULL,
	"numero_documento" text,
	"total_centavos" bigint NOT NULL,
	"soma_itens_centavos" bigint NOT NULL,
	"origem" "origem_dado" NOT NULL,
	"confianca" real NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compra_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "compra_documento_uq" UNIQUE("documento_id"),
	CONSTRAINT "compra_confianca_faixa" CHECK ("compra"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "consentimento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"tipo" "tipo_consentimento" NOT NULL,
	"versao_termo" text NOT NULL,
	"concedido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"revogado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"instituicao" text NOT NULL,
	"conexao_id" text,
	"tipo" text DEFAULT 'corrente' NOT NULL,
	"status" "status_conta" DEFAULT 'ativo' NOT NULL,
	"saldo_inicial_centavos" bigint,
	"saldo_inicial_em" date,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conta_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "conta_conexao_uq" UNIQUE("comerciante_id","conexao_id")
);
--> statement-breakpoint
CREATE TABLE "documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"tipo" "tipo_documento" NOT NULL,
	"arquivo_caminho" text NOT NULL,
	"arquivo_hash" text NOT NULL,
	"status_extracao" "status_extracao" DEFAULT 'pendente' NOT NULL,
	"confianca_media" real,
	"extracao_json" jsonb,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone,
	CONSTRAINT "documento_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "documento_hash_uq" UNIQUE("comerciante_id","arquivo_hash"),
	CONSTRAINT "documento_confianca_faixa" CHECK ("documento"."confianca_media" is null or "documento"."confianca_media" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "fornecedor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text,
	"origem" "origem_dado" NOT NULL,
	"confianca" real DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fornecedor_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "fornecedor_cnpj_uq" UNIQUE("comerciante_id","cnpj"),
	CONSTRAINT "fornecedor_confianca_faixa" CHECK ("fornecedor"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "historico_custo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"fornecedor_id" uuid NOT NULL,
	"data" date NOT NULL,
	"custo_unitario_centavos" bigint NOT NULL,
	"item_de_compra_id" uuid NOT NULL,
	"origem" "origem_dado" NOT NULL,
	"confianca" real NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historico_custo_item_uq" UNIQUE("item_de_compra_id"),
	CONSTRAINT "historico_custo_nao_negativo" CHECK ("historico_custo"."custo_unitario_centavos" >= 0),
	CONSTRAINT "historico_custo_confianca_faixa" CHECK ("historico_custo"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "item_de_compra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"compra_id" uuid NOT NULL,
	"produto_id" uuid,
	"ordem" smallint NOT NULL,
	"descricao_nota" text NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"unidade" text NOT NULL,
	"valor_unitario_centavos" bigint NOT NULL,
	"valor_total_centavos" bigint NOT NULL,
	"confianca" real NOT NULL,
	"origem" "origem_dado" NOT NULL,
	"revisao_pendente" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_de_compra_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "item_de_compra_ordem_uq" UNIQUE("compra_id","ordem"),
	CONSTRAINT "item_de_compra_quantidade_positiva" CHECK ("item_de_compra"."quantidade" > 0),
	CONSTRAINT "item_de_compra_confianca_faixa" CHECK ("item_de_compra"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "item_de_venda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"venda_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"quantidade" numeric(14, 3) NOT NULL,
	"preco_unitario_centavos" bigint NOT NULL,
	"valor_total_centavos" bigint NOT NULL,
	CONSTRAINT "item_de_venda_quantidade_positiva" CHECK ("item_de_venda"."quantidade" > 0)
);
--> statement-breakpoint
CREATE TABLE "mensagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"direcao" "direcao_mensagem" NOT NULL,
	"canal" "canal_mensagem" DEFAULT 'web' NOT NULL,
	"categoria_template" "categoria_template",
	"texto" text NOT NULL,
	"custo_estimado_microdolares" bigint DEFAULT 0 NOT NULL,
	"proativa" boolean DEFAULT false NOT NULL,
	"data_envio" date NOT NULL,
	"chave_idempotencia" text,
	"id_externo" text,
	"execucao_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mensagem_idempotencia_uq" UNIQUE("comerciante_id","chave_idempotencia")
);
--> statement-breakpoint
CREATE TABLE "pergunta_dono" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"tipo" "tipo_pergunta" NOT NULL,
	"status" "status_pergunta" DEFAULT 'pendente' NOT NULL,
	"pergunta" text NOT NULL,
	"contexto" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resposta" text,
	"item_de_compra_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"respondida_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "produto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"codigo_barras" text,
	"sku" text,
	"unidade" text DEFAULT 'un' NOT NULL,
	"categoria" text,
	"preco_meta_centavos" bigint,
	"margem_meta_bps" integer,
	"origem" "origem_dado" NOT NULL,
	"confianca" real DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "produto_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "produto_codigo_barras_uq" UNIQUE("comerciante_id","codigo_barras"),
	CONSTRAINT "produto_sku_uq" UNIQUE("comerciante_id","sku"),
	CONSTRAINT "produto_confianca_faixa" CHECK ("produto"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "transacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"conta_id" uuid NOT NULL,
	"data" date NOT NULL,
	"valor_centavos" bigint NOT NULL,
	"tipo" "tipo_transacao" NOT NULL,
	"descricao" text NOT NULL,
	"categoria" text,
	"id_externo" text,
	"origem" "origem_dado" DEFAULT 'banco' NOT NULL,
	"confianca" real DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transacao_id_externo_uq" UNIQUE("conta_id","id_externo"),
	CONSTRAINT "transacao_valor_positivo" CHECK ("transacao"."valor_centavos" > 0),
	CONSTRAINT "transacao_confianca_faixa" CHECK ("transacao"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "venda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"documento_id" uuid,
	"data" date NOT NULL,
	"hora" time,
	"numero_cupom" text NOT NULL,
	"total_centavos" bigint NOT NULL,
	"origem" "origem_dado" DEFAULT 'planilha' NOT NULL,
	"confianca" real DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venda_id_comerciante_uq" UNIQUE("id","comerciante_id"),
	CONSTRAINT "venda_cupom_uq" UNIQUE("comerciante_id","data","numero_cupom"),
	CONSTRAINT "venda_confianca_faixa" CHECK ("venda"."confianca" between 0 and 1)
);
--> statement-breakpoint
CREATE TABLE "vinculo_descricao_produto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"fornecedor_id" uuid,
	"descricao_normalizada" text NOT NULL,
	"produto_id" uuid NOT NULL,
	"metodo" "metodo_vinculo" NOT NULL,
	"confianca" real NOT NULL,
	"confirmado_pelo_dono" boolean DEFAULT false NOT NULL,
	"confirmado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vinculo_confianca_faixa" CHECK ("vinculo_descricao_produto"."confianca" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "comerciante" ADD COLUMN "margem_meta_bps" integer DEFAULT 2500 NOT NULL;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_execucao_id_execucao_agente_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_agente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_produto_fk" FOREIGN KEY ("produto_id","comerciante_id") REFERENCES "public"."produto"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_fornecedor_fk" FOREIGN KEY ("fornecedor_id","comerciante_id") REFERENCES "public"."fornecedor"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra" ADD CONSTRAINT "compra_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra" ADD CONSTRAINT "compra_documento_fk" FOREIGN KEY ("documento_id","comerciante_id") REFERENCES "public"."documento"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra" ADD CONSTRAINT "compra_fornecedor_fk" FOREIGN KEY ("fornecedor_id","comerciante_id") REFERENCES "public"."fornecedor"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consentimento" ADD CONSTRAINT "consentimento_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conta" ADD CONSTRAINT "conta_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento" ADD CONSTRAINT "documento_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fornecedor" ADD CONSTRAINT "fornecedor_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_custo" ADD CONSTRAINT "historico_custo_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_custo" ADD CONSTRAINT "historico_custo_produto_fk" FOREIGN KEY ("produto_id","comerciante_id") REFERENCES "public"."produto"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_custo" ADD CONSTRAINT "historico_custo_fornecedor_fk" FOREIGN KEY ("fornecedor_id","comerciante_id") REFERENCES "public"."fornecedor"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_custo" ADD CONSTRAINT "historico_custo_item_fk" FOREIGN KEY ("item_de_compra_id","comerciante_id") REFERENCES "public"."item_de_compra"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_de_compra" ADD CONSTRAINT "item_de_compra_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_de_compra" ADD CONSTRAINT "item_de_compra_compra_fk" FOREIGN KEY ("compra_id","comerciante_id") REFERENCES "public"."compra"("id","comerciante_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_de_compra" ADD CONSTRAINT "item_de_compra_produto_fk" FOREIGN KEY ("produto_id","comerciante_id") REFERENCES "public"."produto"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_de_venda" ADD CONSTRAINT "item_de_venda_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_de_venda" ADD CONSTRAINT "item_de_venda_venda_fk" FOREIGN KEY ("venda_id","comerciante_id") REFERENCES "public"."venda"("id","comerciante_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_de_venda" ADD CONSTRAINT "item_de_venda_produto_fk" FOREIGN KEY ("produto_id","comerciante_id") REFERENCES "public"."produto"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_execucao_id_execucao_agente_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_agente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pergunta_dono" ADD CONSTRAINT "pergunta_dono_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pergunta_dono" ADD CONSTRAINT "pergunta_dono_item_fk" FOREIGN KEY ("item_de_compra_id","comerciante_id") REFERENCES "public"."item_de_compra"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "produto" ADD CONSTRAINT "produto_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacao" ADD CONSTRAINT "transacao_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transacao" ADD CONSTRAINT "transacao_conta_fk" FOREIGN KEY ("conta_id","comerciante_id") REFERENCES "public"."conta"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda" ADD CONSTRAINT "venda_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venda" ADD CONSTRAINT "venda_documento_fk" FOREIGN KEY ("documento_id","comerciante_id") REFERENCES "public"."documento"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_descricao_produto" ADD CONSTRAINT "vinculo_descricao_produto_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_descricao_produto" ADD CONSTRAINT "vinculo_fornecedor_fk" FOREIGN KEY ("fornecedor_id","comerciante_id") REFERENCES "public"."fornecedor"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vinculo_descricao_produto" ADD CONSTRAINT "vinculo_produto_fk" FOREIGN KEY ("produto_id","comerciante_id") REFERENCES "public"."produto"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerta_comerciante_data_idx" ON "alerta" USING btree ("comerciante_id","data_referencia","status");--> statement-breakpoint
CREATE INDEX "compra_comerciante_data_idx" ON "compra" USING btree ("comerciante_id","data");--> statement-breakpoint
CREATE INDEX "compra_fornecedor_idx" ON "compra" USING btree ("comerciante_id","fornecedor_id");--> statement-breakpoint
CREATE INDEX "consentimento_comerciante_idx" ON "consentimento" USING btree ("comerciante_id","tipo");--> statement-breakpoint
CREATE INDEX "conta_comerciante_idx" ON "conta" USING btree ("comerciante_id");--> statement-breakpoint
CREATE INDEX "documento_comerciante_status_idx" ON "documento" USING btree ("comerciante_id","status_extracao");--> statement-breakpoint
CREATE INDEX "fornecedor_comerciante_idx" ON "fornecedor" USING btree ("comerciante_id");--> statement-breakpoint
CREATE INDEX "historico_custo_busca_idx" ON "historico_custo" USING btree ("comerciante_id","produto_id","fornecedor_id","data");--> statement-breakpoint
CREATE INDEX "item_de_compra_produto_idx" ON "item_de_compra" USING btree ("comerciante_id","produto_id");--> statement-breakpoint
CREATE INDEX "item_de_venda_venda_idx" ON "item_de_venda" USING btree ("venda_id");--> statement-breakpoint
CREATE INDEX "item_de_venda_produto_idx" ON "item_de_venda" USING btree ("comerciante_id","produto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mensagem_uma_proativa_por_dia_uq" ON "mensagem" USING btree ("comerciante_id","data_envio") WHERE "mensagem"."proativa" and "mensagem"."direcao" = 'enviada';--> statement-breakpoint
CREATE INDEX "mensagem_comerciante_idx" ON "mensagem" USING btree ("comerciante_id","criado_em");--> statement-breakpoint
CREATE INDEX "pergunta_dono_status_idx" ON "pergunta_dono" USING btree ("comerciante_id","status");--> statement-breakpoint
CREATE INDEX "produto_comerciante_idx" ON "produto" USING btree ("comerciante_id");--> statement-breakpoint
CREATE INDEX "produto_nome_trgm_idx" ON "produto" USING gin ("nome" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transacao_comerciante_data_idx" ON "transacao" USING btree ("comerciante_id","data");--> statement-breakpoint
CREATE INDEX "venda_comerciante_data_idx" ON "venda" USING btree ("comerciante_id","data");--> statement-breakpoint
CREATE INDEX "vinculo_busca_idx" ON "vinculo_descricao_produto" USING btree ("comerciante_id","descricao_normalizada","criado_em");--> statement-breakpoint
CREATE INDEX "vinculo_descricao_trgm_idx" ON "vinculo_descricao_produto" USING gin ("descricao_normalizada" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "comerciante" ADD CONSTRAINT "comerciante_margem_meta_faixa" CHECK ("comerciante"."margem_meta_bps" between 0 and 10000);