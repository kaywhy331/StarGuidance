/*
 * Remove legacy plaintext birth metadata and make the one-root, one-follow-up,
 * and retry-safe reading invariants database-enforced.
 */
UPDATE "profile_snapshots"
SET "derived_payload" = "derived_payload" - 'metadata'
WHERE "derived_payload" ? 'metadata';--> statement-breakpoint

DO $integrity_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "birth_profiles" GROUP BY "user_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'birth_profiles contains duplicate user roots; reconcile them before migration 0005';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "follow_up_questions" GROUP BY "reading_id" HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'follow_up_questions contains multiple rows per reading; reconcile them before migration 0005';
  END IF;
END
$integrity_preflight$;--> statement-breakpoint

ALTER TABLE "reading_sessions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "reading_sessions" SET "idempotency_key" = "id"::text;--> statement-breakpoint
ALTER TABLE "reading_sessions" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "birth_profiles_user_unique" ON "birth_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_questions_reading_unique" ON "follow_up_questions" USING btree ("reading_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_sessions_user_idempotency_unique" ON "reading_sessions" USING btree ("user_id","idempotency_key");
