CREATE TABLE "limite_alerta" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comerciante_id" uuid NOT NULL,
	"limite" text NOT NULL,
	"valor" numeric(14, 4),
	"origem" "origem_dado" DEFAULT 'dono' NOT NULL,
	"confianca" real DEFAULT 1 NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "limite_alerta_valor_nulo" CHECK ("limite_alerta"."valor" is not null or "limite_alerta"."limite" like 'janelaSupressaoDias.%'),
	CONSTRAINT "limite_alerta_confianca_faixa" CHECK ("limite_alerta"."confianca" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "limite_alerta" ADD CONSTRAINT "limite_alerta_comerciante_id_comerciante_id_fk" FOREIGN KEY ("comerciante_id") REFERENCES "public"."comerciante"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "limite_alerta_busca_idx" ON "limite_alerta" USING btree ("comerciante_id","limite","criado_em");--> statement-breakpoint
-- Regra inviolável 10: o limite anterior nunca é alterado nem apagado (mesma regra do custo).
CREATE TRIGGER limite_alerta_append_only
  BEFORE UPDATE OR DELETE ON limite_alerta
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_historico();
