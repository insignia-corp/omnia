ALTER TYPE "public"."gatilho_execucao" ADD VALUE 'extracao_nota';--> statement-breakpoint
CREATE TABLE "mapeamento_planilha" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"assinatura" text NOT NULL,
	"mapeamento" jsonb NOT NULL,
	"confirmado_pelo_dono" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mapeamento_planilha_assinatura_uq" UNIQUE("comerciante_id","assinatura")
);
--> statement-breakpoint
ALTER TABLE "historico_custo" DROP CONSTRAINT "historico_custo_item_uq";--> statement-breakpoint
ALTER TABLE "documento" ADD COLUMN "motivos_validacao" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "mapeamento_planilha" ADD CONSTRAINT "mapeamento_planilha_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "historico_custo_item_idx" ON "historico_custo" USING btree ("item_de_compra_id","criado_em");