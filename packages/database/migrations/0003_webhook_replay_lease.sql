ALTER TABLE "payment_webhook_events" ADD COLUMN "processing_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD COLUMN "last_failure_code" text;
