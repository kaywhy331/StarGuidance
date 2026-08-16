CREATE TABLE "interpretation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"deduplication_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"lock_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "interpretation_jobs" ADD CONSTRAINT "interpretation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretation_jobs" ADD CONSTRAINT "interpretation_jobs_reading_id_reading_sessions_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."reading_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interpretation_jobs_dedup_unique" ON "interpretation_jobs" USING btree ("deduplication_key");--> statement-breakpoint
CREATE INDEX "interpretation_jobs_claimable_idx" ON "interpretation_jobs" USING btree ("status","available_at","lock_expires_at");--> statement-breakpoint

/*
 * interpretation_jobs is not user-row-scoped, for the same reason as
 * rate_limit_buckets (migration 0006): the worker's claim query
 * (FOR UPDATE SKIP LOCKED across every pending job) is inherently
 * cross-user, so there is no single request.jwt.claim.sub to bind a policy
 * to. `USING (true)` restricted to the non-login starguidance_app grant —
 * never authenticated/anon/PUBLIC — is the same boundary every other table
 * has: nothing reachable from a browser JWT, only the trusted server role.
 * Unlike payment_webhook_events (migration 0004), this is intentionally
 * NOT revoked from starguidance_app: POST /api/readings, running as the
 * requesting user's normal actor-bound transaction, inserts a row here in
 * the SAME transaction as the reading it belongs to, and that's only
 * possible if starguidance_app itself has grants on the table.
 */
ALTER TABLE "interpretation_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "interpretation_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "interpretation_jobs_app_only" ON "interpretation_jobs" FOR ALL USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "interpretation_jobs" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE interpretation_jobs FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "interpretation_jobs" TO starguidance_app;