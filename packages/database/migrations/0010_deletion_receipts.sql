CREATE TABLE "deletion_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_hash" text NOT NULL,
	"policy_version" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

/*
 * Deletion tombstones (gap G13). audit_events carry a user_id with an
 * enforced cascade, so deleting an account erases the very audit trail that
 * would prove the erasure happened. deletion_receipts is deliberately
 * user-less: a domain-separated SHA-256 of the subject, the policy version
 * the deletion ran under, and when it was requested — written by the account
 * route after re-authentication succeeds and before the Auth identity is
 * deleted, so no cascade can reach it.
 *
 * Access posture: the application role may only ever APPEND. Reading,
 * updating, or deleting receipts is reserved for the owning connection role
 * (the same explicit-system-policy pattern as interpretation_jobs, migration
 * 0008) — receipts answer operator/compliance questions, not application
 * queries, and an append-only surface can't be used to enumerate hashes.
 */
ALTER TABLE "deletion_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deletion_receipts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "deletion_receipts_append" ON "deletion_receipts" FOR INSERT TO starguidance_app
  WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "deletion_receipts_system" ON "deletion_receipts" FOR ALL TO CURRENT_USER
  USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "deletion_receipts" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE deletion_receipts FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT INSERT ON TABLE "deletion_receipts" TO starguidance_app;
