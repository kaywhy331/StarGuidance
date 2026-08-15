CREATE TABLE "rate_limit_buckets" (
	"key_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_buckets_key_hash_window_start_pk" PRIMARY KEY("key_hash","window_start")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint

/*
 * rate_limit_buckets is not user-row-scoped: it is keyed by an opaque hash,
 * not a subject, and must be visible/writable regardless of which (if any)
 * user the current request is bound to. Every other private table's RLS
 * policy compares a row's user_id to request.jwt.claim.sub (migration 0000);
 * that predicate cannot apply here since there is nothing to compare against
 * before a caller is even authenticated (the auth route rate-limits by IP
 * before any session exists). A permissive `USING (true)` policy still
 * FORCEs row level security and is still granted only to the non-login
 * starguidance_app role — never authenticated/anon/PUBLIC — so the isolation
 * boundary is identical in spirit to every other table: nothing reachable
 * from a browser JWT, only the trusted server role. The residual tradeoff is
 * that starguidance_app itself has no per-row scoping on this table, unlike
 * every user-owned table; application code must not rely on RLS to filter
 * these rows and should always query by an explicit key_hash.
 */
ALTER TABLE "rate_limit_buckets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "rate_limit_buckets_app_only" ON "rate_limit_buckets" FOR ALL USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "rate_limit_buckets" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE rate_limit_buckets FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "rate_limit_buckets" TO starguidance_app;--> statement-breakpoint

/*
 * Atomic check-and-increment for a fixed rate-limit window. One round trip:
 * the INSERT .. ON CONFLICT DO UPDATE is a single atomically-locked
 * statement, so concurrent callers racing the same key_hash/window_start
 * serialize on the row rather than each reading a stale count and both
 * proceeding (the bug a naive SELECT-then-INSERT/UPDATE would have).
 * SECURITY DEFINER is deliberately not used — the function runs as whatever
 * role calls it (starguidance_app only, per the grant above), consistent
 * with every other write path in this schema.
 */
CREATE FUNCTION check_rate_limit(p_key_hash text, p_limit integer, p_window_ms bigint)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_count integer;
BEGIN
  IF p_limit < 1 OR p_window_ms < 1 THEN
    RAISE EXCEPTION 'check_rate_limit requires a positive limit and window';
  END IF;
  v_window_start := to_timestamp(floor(extract(epoch FROM clock_timestamp()) * 1000 / p_window_ms) * p_window_ms / 1000.0);
  v_expires_at := v_window_start + make_interval(secs => p_window_ms / 1000.0);
  INSERT INTO rate_limit_buckets (key_hash, window_start, count, expires_at)
  VALUES (p_key_hash, v_window_start, 1, v_expires_at)
  ON CONFLICT (key_hash, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
  RETURNING rate_limit_buckets.count INTO v_count;
  RETURN QUERY SELECT
    v_count <= p_limit,
    GREATEST(1, ceil(extract(epoch FROM (v_expires_at - clock_timestamp()))))::integer;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION check_rate_limit(text, integer, bigint) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION check_rate_limit(text, integer, bigint) TO starguidance_app;