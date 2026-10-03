/*
 * Forward security fix: browser roles hold no direct table access.
 *
 * Supabase's platform default ACLs (global and `IN SCHEMA public`, for the
 * `postgres` and `supabase_admin` creators) grant ALL on every new public
 * table, sequence and function to `anon`, `authenticated` and `service_role`.
 * Migrations 0001/0004 only revoked the tables that existed at the time, and
 * the ten tables created without forced RLS (the tarot/commerce reference
 * tables and payment_webhook_events) kept those catalog grants. (Catalog
 * grants were verified; actual Data API reachability was not.)
 *
 * Future functions also carry PostgreSQL's implicit PUBLIC EXECUTE, which
 * `anon` and `authenticated` inherit. A per-schema revoke cannot remove it, so
 * for the creators `postgres` and `supabase_admin` (plus any creator whose
 * defaults name a browser role) this migration revokes EXECUTE FROM PUBLIC in
 * the creator's GLOBAL function defaults. Effect: functions those creators
 * create LATER, in any schema (including extension scripts they run), are not
 * PUBLIC-executable; the creator keeps EXECUTE and `service_role` keeps its
 * explicit default grant. Any other role that must call a future function
 * needs an explicit GRANT EXECUTE in the migration that creates it (as 0006
 * does). Existing functions and their bodies are not changed.
 *
 * Intended access model (docs/OPERATIONS.md, migration 0004):
 *   - Browsers use Supabase for Auth only; no application code queries a table
 *     through supabase-js, so `anon` and `authenticated` need no table access.
 *     This also withdraws the reference-table SELECT that 0001 gave
 *     `authenticated` (prompt/calculation versions and product rows are not
 *     browser content).
 *   - `starguidance_app` keeps SELECT on the nine reference tables (0001/0004)
 *     and no access to payment_webhook_events (0004).
 *   - The owning connection role keeps full webhook lease/idempotency access;
 *     `service_role` is deliberately untouched.
 *
 * Reference and webhook tables are intentionally NOT forced-RLS: they have no
 * per-subject policy, and forcing RLS without policies would lock out the
 * server roles that legitimately read them.
 *
 * Changing another creator's default ACL needs the authority to act as that
 * creator. The authority check runs before anything is changed and raises
 * instead of skipping, so a caller that lacks it fails the whole migration.
 */
DO $authority$
DECLARE
  creator record;
BEGIN
  FOR creator IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('postgres', 'supabase_admin')
    UNION
    SELECT r.rolname
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclobjtype IN ('r', 'S', 'f')
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND (
        a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
        OR (a.grantee = 0 AND d.defaclobjtype IN ('r', 'S'))
      )
  LOOP
    IF NOT pg_has_role(current_user, creator.rolname, 'SET') THEN
      RAISE EXCEPTION
        'Migration 0029 cannot remove browser-role default privileges created by role "%": % cannot act as it. Re-run as that role or as a superuser; nothing was changed.',
        creator.rolname, current_user
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END LOOP;
END
$authority$;--> statement-breakpoint

DO $default_privileges$
DECLARE
  entry record;
  browser_roles text;
  kind text;
  grantees text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO browser_roles
  FROM pg_roles WHERE rolname IN ('anon', 'authenticated');

  FOR entry IN
    SELECT DISTINCT r.rolname, d.defaclnamespace, d.defaclobjtype
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclobjtype IN ('r', 'S', 'f')
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND (
        a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
        OR (a.grantee = 0 AND d.defaclobjtype IN ('r', 'S'))
      )
  LOOP
    kind := CASE entry.defaclobjtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' ELSE 'FUNCTIONS' END;
    grantees := 'PUBLIC, ' || browser_roles;
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE ALL ON %s FROM %s',
      entry.rolname,
      CASE WHEN entry.defaclnamespace = 0 THEN '' ELSE 'IN SCHEMA public' END,
      kind,
      grantees
    );
  END LOOP;

  -- Implicit PUBLIC EXECUTE lives only in the creator-global default, so it is
  -- revoked there for every creator the authority check covered, whether or
  -- not its defaults name a browser role.
  FOR entry IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('postgres', 'supabase_admin')
    UNION
    SELECT r.rolname
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclobjtype = 'f'
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', entry.rolname);
  END LOOP;
END
$default_privileges$;--> statement-breakpoint

DO $browser_tables$
DECLARE
  table_name text;
  sequence_name text;
  browser_roles text;
BEGIN
  SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname) INTO browser_roles
  FROM pg_roles WHERE rolname IN ('anon', 'authenticated');

  FOREACH table_name IN ARRAY ARRAY[
    'calculation_versions', 'card_meanings', 'cards', 'content_versions', 'decks',
    'payment_webhook_events', 'products', 'prompt_versions', 'spread_positions', 'spreads'
  ]
  LOOP
    -- Table-level REVOKE also clears any column-level grants.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, %s', table_name, browser_roles);
    FOR sequence_name IN
      SELECT d.objid::regclass::text
      FROM pg_depend d
      JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
      WHERE d.refobjid = format('public.%I', table_name)::regclass
        AND d.deptype IN ('a', 'i')
    LOOP
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, %s', sequence_name, browser_roles);
    END LOOP;
  END LOOP;
END
$browser_tables$;--> statement-breakpoint

DO $guard$
DECLARE
  table_name text;
  browser_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'calculation_versions', 'card_meanings', 'cards', 'content_versions', 'decks',
    'payment_webhook_events', 'products', 'prompt_versions', 'spread_positions', 'spreads'
  ]
  LOOP
    FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) AND (
        has_table_privilege(browser_role, format('public.%I', table_name),
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        OR has_any_column_privilege(browser_role, format('public.%I', table_name),
          'SELECT, INSERT, UPDATE, REFERENCES')
      ) THEN
        RAISE EXCEPTION '% retains access to public.%', browser_role, table_name;
      END IF;
    END LOOP;

    IF table_name = 'payment_webhook_events' THEN
      IF has_table_privilege('starguidance_app', 'public.payment_webhook_events', 'SELECT') THEN
        RAISE EXCEPTION 'starguidance_app must not reach payment_webhook_events';
      END IF;
    ELSIF NOT has_table_privilege('starguidance_app', format('public.%I', table_name), 'SELECT') THEN
      RAISE EXCEPTION 'starguidance_app lost reference read access to public.%', table_name;
    END IF;
  END LOOP;

  -- A creator default that still grants a browser role would silently re-expose
  -- the next table, sequence or function.
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclobjtype IN ('r', 'S', 'f')
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon', 'authenticated'))
  ) THEN
    RAISE EXCEPTION 'A default ACL still grants anon or authenticated on new public objects';
  END IF;

  -- Effective check: a creator with no global function-default row, or one that
  -- still lists PUBLIC, leaves new functions executable by every browser role.
  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE (
        r.rolname IN ('postgres', 'supabase_admin')
        OR EXISTS (
          SELECT 1 FROM pg_default_acl x
          WHERE x.defaclrole = r.oid AND x.defaclobjtype = 'f'
            AND x.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_default_acl d
        WHERE d.defaclrole = r.oid AND d.defaclobjtype = 'f' AND d.defaclnamespace = 0
          AND NOT EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a WHERE a.grantee = 0)
      )
  ) THEN
    RAISE EXCEPTION 'A creator default still leaves new functions executable by PUBLIC';
  END IF;
END
$guard$;
