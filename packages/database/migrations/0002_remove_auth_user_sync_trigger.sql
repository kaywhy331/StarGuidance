-- Removes the SECURITY DEFINER auth.users -> public.users synchronisation trigger.
--
-- Why: `FORCE ROW LEVEL SECURITY` on public.users applies to the table owner and
-- to SECURITY DEFINER functions alike. The trigger ran inside GoTrue's signup
-- transaction, where `request.jwt.claim.sub` is unset, so the `users_self`
-- WITH CHECK clause evaluated to NULL and the insert was rejected. Supabase Auth
-- surfaced that as HTTP 500 and no identity could be created at all.
--
-- The replacement is the application provisioning boundary, not a weaker policy:
-- requireUser() validates the Supabase subject, then repositories.users.ensure()
-- inserts the row as the `authenticated` role with the verified subject bound to
-- request.jwt.claim.sub. The row can only ever be the caller's own.
--
-- This migration deliberately introduces no BYPASSRLS role, no service-role
-- policy, no trigger-specific RLS exception, no replacement SECURITY DEFINER
-- function and no temporary disabling of row level security. Every existing
-- protection is retained, and the guard block at the end fails the migration if
-- any of them were lost.

DO $drop_sync_trigger$
BEGIN
  -- `auth.users` exists on a Supabase project but not on a plain Postgres
  -- database, where 0001 never created the trigger. Referencing the table
  -- unconditionally would abort the migration with `relation does not exist`.
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS sync_authenticated_user_after_insert
    ON auth.users;
  END IF;
END
$drop_sync_trigger$;--> statement-breakpoint

DROP FUNCTION IF EXISTS public.sync_authenticated_user();--> statement-breakpoint

DO $assert_removed_and_preserved$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'users'
      AND t.tgname = 'sync_authenticated_user_after_insert'
  ) THEN
    RAISE EXCEPTION 'The auth.users synchronisation trigger still exists after migration 0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_authenticated_user'
  ) THEN
    RAISE EXCEPTION 'public.sync_authenticated_user() still exists after migration 0002';
  END IF;

  -- Forced row level security must survive untouched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'users'
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'public.users must keep FORCE ROW LEVEL SECURITY';
  END IF;

  -- The self-ownership policy is the only thing standing between the
  -- authenticated role and another person's row.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'users' AND policyname = 'users_self'
  ) THEN
    RAISE EXCEPTION 'The users_self ownership policy must be preserved';
  END IF;

  -- Provisioning now happens as `authenticated`, so those grants are required.
  IF NOT (
    has_table_privilege('authenticated', 'public.users', 'INSERT')
    AND has_table_privilege('authenticated', 'public.users', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.users', 'SELECT')
    AND has_table_privilege('authenticated', 'public.users', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'The authenticated role must retain its public.users grants';
  END IF;

  -- The webhook ledger stays service-only.
  IF has_table_privilege('authenticated', 'public.payment_webhook_events', 'SELECT') THEN
    RAISE EXCEPTION 'payment_webhook_events must remain withheld from the authenticated role';
  END IF;

  -- Deleting the Auth identity must still cascade into application data. This
  -- is now the only link between the two schemas.
  IF to_regclass('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'users_auth_user_id_fk'
        AND conrelid = 'public.users'::regclass
        AND confrelid = 'auth.users'::regclass
        AND confdeltype = 'c'
    ) THEN
      RAISE EXCEPTION 'public.users.id must keep its ON DELETE CASCADE foreign key onto auth.users';
    END IF;
  END IF;
END
$assert_removed_and_preserved$;
