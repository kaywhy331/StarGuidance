ALTER TABLE "reading_feedback" ADD COLUMN "kind" text DEFAULT 'experience' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_feedback" ADD COLUMN "outcome_status" text;--> statement-breakpoint
ALTER TABLE "reading_feedback" ADD COLUMN "behavior_changed" boolean;