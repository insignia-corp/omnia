-- Revisão do PR 116: tenant-safety nos vínculos com a execução do agente e idempotência de entrada.
--
-- 1. alerta, chamada_ferramenta e mensagem apontam para a execução por (id, comerciante_id), então
--    o banco recusa vínculo entre dados de lojistas diferentes (regra inviolável 3).
--    Nos dois casos de SET NULL, só execucao_id vai a nulo (PostgreSQL 15+): comerciante_id é NOT NULL.
-- 2. mensagem.id_externo ganha índice único parcial: a reentrega do mesmo webhook não duplica a mensagem.
ALTER TABLE "execucao_agente" ADD CONSTRAINT "execucao_agente_id_comerciante_uq" UNIQUE("id","comerciante_id");--> statement-breakpoint
ALTER TABLE "alerta" DROP CONSTRAINT "alerta_execucao_id_execucao_agente_id_fk";
--> statement-breakpoint
ALTER TABLE "chamada_ferramenta" DROP CONSTRAINT "chamada_ferramenta_execucao_id_execucao_agente_id_fk";
--> statement-breakpoint
ALTER TABLE "mensagem" DROP CONSTRAINT "mensagem_execucao_id_execucao_agente_id_fk";
--> statement-breakpoint
ALTER TABLE "alerta" ADD CONSTRAINT "alerta_execucao_fk" FOREIGN KEY ("execucao_id","comerciante_id") REFERENCES "public"."execucao_agente"("id","comerciante_id") ON DELETE set null ("execucao_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamada_ferramenta" ADD CONSTRAINT "chamada_ferramenta_execucao_fk" FOREIGN KEY ("execucao_id","comerciante_id") REFERENCES "public"."execucao_agente"("id","comerciante_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_execucao_fk" FOREIGN KEY ("execucao_id","comerciante_id") REFERENCES "public"."execucao_agente"("id","comerciante_id") ON DELETE set null ("execucao_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mensagem_id_externo_uq" ON "mensagem" USING btree ("comerciante_id","canal","id_externo") WHERE "mensagem"."id_externo" is not null;
