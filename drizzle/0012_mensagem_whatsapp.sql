CREATE TYPE "public"."status_mensagem" AS ENUM('sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tipo_mensagem" AS ENUM('text', 'image', 'document', 'interactive', 'template', 'button');--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "tipo" "tipo_mensagem" DEFAULT 'text' NOT NULL;--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "conteudo" jsonb;--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "contexto_id" text;--> statement-breakpoint
ALTER TABLE "mensagem" ADD COLUMN "status" "status_mensagem";