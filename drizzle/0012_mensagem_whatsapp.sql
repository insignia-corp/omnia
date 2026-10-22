CREATE TYPE "public"."status_mensagem" AS ENUM('sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tipo_mensagem" AS ENUM('text', 'image', 'document', 'interactive', 'template', 'button');--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "tipo" "tipo_mensagem" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "conteudo" jsonb;--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "contexto_id" text;--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "status" "status_mensagem";--> statement-breakpoint
-- Mensagens de antes desta migração: a do dono já foi tratada (lida) e a do agente que tem id do canal já saiu.
UPDATE "mensagem" SET "status" = 'read' WHERE "direcao" = 'recebida' AND "status" IS NULL;--> statement-breakpoint
UPDATE "mensagem" SET "status" = 'sent' WHERE "direcao" = 'enviada' AND "status" IS NULL AND "id_externo" IS NOT NULL;
