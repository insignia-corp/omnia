CREATE TABLE "historico_preco_meta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"produto_id" uuid NOT NULL,
	"preco_meta_centavos" bigint NOT NULL,
	"anterior_centavos" bigint,
	"origem" "origem_dado" DEFAULT 'dono' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "historico_preco_meta_positivo" CHECK ("historico_preco_meta"."preco_meta_centavos" > 0)
);
--> statement-breakpoint
ALTER TABLE "historico_preco_meta" ADD CONSTRAINT "historico_preco_meta_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historico_preco_meta" ADD CONSTRAINT "historico_preco_meta_produto_fk" FOREIGN KEY ("produto_id","comerciante_id") REFERENCES "public"."produto"("id","comerciante_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "historico_preco_meta_busca_idx" ON "historico_preco_meta" USING btree ("comerciante_id","produto_id","criado_em");--> statement-breakpoint
-- Regra inviolável 10: o preço-meta anterior nunca é alterado nem apagado (mesma regra do custo).
CREATE TRIGGER historico_preco_meta_append_only
  BEFORE UPDATE OR DELETE ON historico_preco_meta
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_historico();
