ALTER TABLE "reading_draws" ADD COLUMN "proof" jsonb;--> statement-breakpoint
ALTER TABLE "reading_draws" ADD COLUMN "encrypted_server_seed" text;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "configuration" jsonb;