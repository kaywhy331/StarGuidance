/*
 * Subject-bind interpretation_jobs for the request path (gap G9).
 *
 * Migration 0007 shipped a permissive USING (true) policy on the grounds that
 * the worker's claim query is inherently cross-user. That reasoning holds for
 * the CLAIM path but over-granted the REQUEST path: POST /api/readings inserts
 * the job inside the requesting user's actor-bound transaction, and under
 * USING (true) that same starguidance_app + request.jwt.claim.sub binding
 * could read and update every other user's job rows too — the only user-linked
 * table where the actor role had no per-row scoping.
 *
 * The split below mirrors the payment_webhook_events boundary (migration
 * 0004): trusted maintenance traffic runs as the connection role, application
 * traffic is constrained. Unlike payment_webhook_events, RLS stays ENABLEd and
 * FORCEd here, so the connection role's claim path exists as an explicit named
 * policy rather than as the accidental absence of RLS:
 *
 * - interpretation_jobs_subject (TO starguidance_app): the request path.
 *   Enqueue-on-create, the user-triggered retry re-enqueue, and any future
 *   subject-scoped read are all bound to request.jwt.claim.sub exactly like
 *   every user-owned table (migration 0000). A transaction bound to user A
 *   can no longer touch user B's jobs, and a subject-less starguidance_app
 *   transaction (systemTransaction) sees no rows at all.
 * - interpretation_jobs_system (TO CURRENT_USER, resolved at migration time to
 *   the connection role that owns the schema and runs the worker): the claim /
 *   complete / fail / queue-stats path in apps/web/src/lib/interpretation-worker.ts,
 *   which is cross-user by design and never executes application-controlled
 *   input. This is the same role payment_webhook_events already trusts via
 *   serviceTransaction.
 */
DROP POLICY "interpretation_jobs_app_only" ON "interpretation_jobs";--> statement-breakpoint
CREATE POLICY "interpretation_jobs_subject" ON "interpretation_jobs" FOR ALL TO starguidance_app
  USING ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "interpretation_jobs_system" ON "interpretation_jobs" FOR ALL TO CURRENT_USER
  USING (true) WITH CHECK (true);--> statement-breakpoint

/*
 * The connection role must not be starguidance_app itself (the policies above
 * would collapse into one), and the subject policy must actually be scoped to
 * the app role rather than PUBLIC. Fail the migration loudly if either
 * assumption is wrong instead of leaving a silently weaker boundary.
 */
DO $guard$
BEGIN
  IF current_user = 'starguidance_app' THEN
    RAISE EXCEPTION 'migration 0008 must run as the owning connection role, not starguidance_app';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'interpretation_jobs'
      AND policyname = 'interpretation_jobs_subject'
      AND roles = ARRAY['starguidance_app']::name[]
  ) THEN
    RAISE EXCEPTION 'interpretation_jobs_subject is not scoped to starguidance_app';
  END IF;
END
$guard$;
