/*
 * Existing outputs predate full per-output provenance. Preserve them with an
 * explicit unknown marker instead of inventing a model, prompt, content, or
 * policy version. New application writes always supply the exact values.
 */
ALTER TABLE "follow_up_questions" ADD COLUMN "provider_id" text DEFAULT 'legacy-unrecorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_up_questions" ADD COLUMN "prompt_version" text DEFAULT 'legacy-unrecorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_up_questions" ADD COLUMN "content_version" text DEFAULT 'legacy-unrecorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_up_questions" ADD COLUMN "safety_policy_version" text DEFAULT 'legacy-unrecorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "follow_up_questions" ADD COLUMN "schema_version" text DEFAULT 'legacy-unrecorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_outputs" ADD COLUMN "safety_policy_version" text DEFAULT 'legacy-unrecorded' NOT NULL;
