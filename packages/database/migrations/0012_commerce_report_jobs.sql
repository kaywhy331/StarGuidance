/*
 * Durable paid-report fulfillment plus finance/profile separation (Wave 5).
 * Commerce rows retain reconciliation and generated product content after a
 * private-profile deletion; their snapshot pointers are nulled by the FK.
 * report_jobs carries only a context-bound encrypted derived-profile source,
 * never raw birth input, and clears it after successful generation.
 */
CREATE TABLE "report_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"encrypted_source" text,
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
ALTER TABLE "entitlements" DROP CONSTRAINT "entitlements_profile_snapshot_id_profile_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_profile_snapshot_id_profile_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "reports" DROP CONSTRAINT "reports_profile_snapshot_id_profile_snapshots_id_fk";
--> statement-breakpoint
ALTER TABLE "entitlements" ALTER COLUMN "profile_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "profile_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reports" ALTER COLUMN "profile_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_jobs" ADD CONSTRAINT "report_jobs_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "report_jobs_report_unique" ON "report_jobs" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "report_jobs_claimable_idx" ON "report_jobs" USING btree ("status","available_at","lock_expires_at");--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_profile_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("profile_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_profile_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("profile_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_profile_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("profile_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "report_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "report_jobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "report_jobs_subject" ON "report_jobs" FOR ALL TO starguidance_app
  USING ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "report_jobs_system" ON "report_jobs" FOR ALL TO CURRENT_USER
  USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "report_jobs" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE report_jobs FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "report_jobs" TO starguidance_app;--> statement-breakpoint

DO $guard$
BEGIN
  IF current_user = 'starguidance_app' THEN
    RAISE EXCEPTION 'migration 0012 must run as the owning connection role, not starguidance_app';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'report_jobs'
      AND policyname = 'report_jobs_subject'
      AND roles = ARRAY['starguidance_app']::name[]
  ) THEN
    RAISE EXCEPTION 'report_jobs_subject is not scoped to starguidance_app';
  END IF;
END
$guard$;
