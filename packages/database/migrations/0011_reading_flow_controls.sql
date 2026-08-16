/*
 * Add operator kill switches for versioned tarot content and replace the
 * one-follow-up database constraint with an index. Follow-up cardinality is
 * now enforced transactionally by the configurable application policy.
 */
DROP INDEX "follow_up_questions_reading_unique";--> statement-breakpoint
ALTER TABLE "decks" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "spreads" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "follow_up_questions_reading_idx" ON "follow_up_questions" USING btree ("reading_id");
