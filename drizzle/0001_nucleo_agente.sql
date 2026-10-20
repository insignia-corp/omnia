CREATE TYPE "public"."gatilho_execucao" AS ENUM('relatorio_diario', 'mensagem_dono', 'nota_processada');--> statement-breakpoint
CREATE TYPE "public"."resultado_execucao" AS ENUM('aprovada', 'fallback_verificador', 'fallback_erro', 'recusa_modelo');--> statement-breakpoint
CREATE TABLE "chamada_ferramenta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execucao_id" uuid NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"ordem" smallint NOT NULL,
	"ferramenta" text NOT NULL,
	"entrada" jsonb NOT NULL,
	"saida" jsonb,
	"erro" text,
	"menor_confianca" real,
	"latencia_ms" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comerciante" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"telefone_whatsapp" text,
	"tipo_comercio" text DEFAULT 'mercadinho' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comerciante_telefone_whatsapp_unique" UNIQUE("telefone_whatsapp")
);
--> statement-breakpoint
CREATE TABLE "execucao_agente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"gatilho" "gatilho_execucao" NOT NULL,
	"entrada" text NOT NULL,
	"modelo" text NOT NULL,
	"versao_prompt" text NOT NULL,
	"resultado" "resultado_execucao" NOT NULL,
	"mensagem_final" text NOT NULL,
	"iteracoes" smallint NOT NULL,
	"bloqueios_verificador" smallint NOT NULL,
	"detalhes_verificador" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tokens_entrada" integer NOT NULL,
	"tokens_saida" integer NOT NULL,
	"tokens_cache_leitura" integer DEFAULT 0 NOT NULL,
	"custo_estimado_microdolares" bigint NOT NULL,
	"latencia_ms" integer NOT NULL,
	"erro" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chamada_ferramenta" ADD CONSTRAINT "chamada_ferramenta_execucao_id_execucao_agente_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao_agente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamada_ferramenta" ADD CONSTRAINT "chamada_ferramenta_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao_agente" ADD CONSTRAINT "execucao_agente_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chamada_ferramenta_execucao_idx" ON "chamada_ferramenta" USING btree ("execucao_id","ordem");--> statement-breakpoint
CREATE INDEX "execucao_agente_comerciante_idx" ON "execucao_agente" USING btree ("comerciante_id","criado_em");