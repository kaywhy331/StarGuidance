/*
 * Separate browser JWTs from the server-side persistence capability.
 *
 * Supabase maps a signed-in browser to `authenticated`. The web application
 * never reads private tables from the browser; it verifies the Auth subject on
 * the server, then uses `starguidance_app` with that subject bound for RLS.
 * Leaving DML on `authenticated` would let a browser bypass the server and
 * replace locked draws or grant itself a paid entitlement.
 */
DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'starguidance_app') THEN
    CREATE ROLE starguidance_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'starguidance_app'
      AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'starguidance_app must remain a NOLOGIN, NOINHERIT, non-privileged RLS role';
  END IF;

  -- The migration/runtime connection must explicitly SET ROLE for each
  -- subject-scoped transaction. NOLOGIN keeps the role from owning a secret.
  EXECUTE format('GRANT starguidance_app TO %I', current_user);
END
$role$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO starguidance_app;--> statement-breakpoint

DO $private_tables$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'user_settings', 'consents', 'birth_profiles', 'profile_snapshots',
    'profile_components', 'profile_traits', 'reading_sessions', 'reading_draws',
    'reading_outputs', 'follow_up_questions', 'reading_feedback', 'orders',
    'entitlements', 'reports', 'report_sections', 'audit_events'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, authenticated', table_name);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO starguidance_app',
      table_name
    );
  END LOOP;
END
$private_tables$;--> statement-breakpoint

GRANT SELECT ON TABLE decks, cards, card_meanings, spreads, spread_positions, products,
  prompt_versions, calculation_versions, content_versions TO starguidance_app;--> statement-breakpoint

REVOKE ALL ON TABLE payment_webhook_events FROM PUBLIC, authenticated, starguidance_app;--> statement-breakpoint

DO $guard$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'user_settings', 'consents', 'birth_profiles', 'profile_snapshots',
    'profile_components', 'profile_traits', 'reading_sessions', 'reading_draws',
    'reading_outputs', 'follow_up_questions', 'reading_feedback', 'orders',
    'entitlements', 'reports', 'report_sections', 'audit_events'
  ]
  LOOP
    IF has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
      OR has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
      OR has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
      OR has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') THEN
      RAISE EXCEPTION 'authenticated retains a private-table privilege on %', table_name;
    END IF;
    IF NOT (
      has_table_privilege('starguidance_app', format('public.%I', table_name), 'SELECT')
      AND has_table_privilege('starguidance_app', format('public.%I', table_name), 'INSERT')
      AND has_table_privilege('starguidance_app', format('public.%I', table_name), 'UPDATE')
      AND has_table_privilege('starguidance_app', format('public.%I', table_name), 'DELETE')
    ) THEN
      RAISE EXCEPTION 'starguidance_app lacks its scoped table privileges on %', table_name;
    END IF;
  END LOOP;
END
$guard$;
