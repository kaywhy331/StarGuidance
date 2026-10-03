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
 * for the creators `postgres` and `supabase_admin` (plus EVERY creator with a
 * global or public-schema table, sequence or function default row, whether or
 * not it names a browser role) this migration revokes EXECUTE FROM PUBLIC in
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
 * One creator set is frozen BEFORE any ACL is touched and used for every
 * step and postcondition: `postgres`, `supabase_admin`, and EVERY role with a
 * default ACL row for tables, sequences or functions (global or IN SCHEMA
 * public), whether or not that row names a browser role; each such creator's
 * global function default loses PUBLIC EXECUTE. It is never rediscovered from browser grants that this migration
 * removes. For each frozen creator every existing row in that scope has PUBLIC,
 * `anon` and `authenticated` revoked (other grantees, incl. service_role, are
 * kept) and the global function default always gets EXECUTE revoked from PUBLIC,
 * which also leaves a durable row so post-migration audits find the creator.
 *
 * Effective access is judged through PUBLIC and role inheritance. A default
 * that reaches a browser role only through a group role it inherits cannot be
 * revoked without affecting that group's other members, so the migration
 * rejects that state (nothing changed) and names the owner action.
 *
 * Authority: ALTER DEFAULT PRIVILEGES FOR ROLE needs the executor to hold the
 * creator's privileges (inherited), which pg_has_role(..., 'SET') does not
 * prove. Every statement therefore runs first in a sub-transaction that is
 * always rolled back. A non-owner holding only some privilege gets a WARNING
 * and a no-op from REVOKE, not an error, so after each table and sequence
 * REVOKE the effective browser/PUBLIC access is checked, in the trial too; any
 * leftover raises a precise error before the real pass, so the catalog is
 * unchanged. No role is switched and no
 * membership or privilege is added.
 */
DO $default_privileges$
DECLARE
  creators text[];
  inherited record;
  entry record;
  grantees text;
  table_name text;
  sequence_name text;
  attempt int;
  step text := 'default privileges';
  detail text;
BEGIN
  grantees := concat_ws(', ', 'PUBLIC',
    (SELECT string_agg(quote_ident(rolname), ', ' ORDER BY rolname)
     FROM pg_roles WHERE rolname IN ('anon', 'authenticated')));

  -- Freeze the creator set before anything is changed.
  SELECT coalesce(array_agg(c.rolname ORDER BY c.rolname), ARRAY[]::text[]) INTO creators
  FROM (
    SELECT rolname FROM pg_roles WHERE rolname IN ('postgres', 'supabase_admin')
    UNION
    SELECT r.rolname
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    WHERE d.defaclobjtype IN ('r', 'S', 'f')
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
  ) c;

  -- A group role granted a default and inherited by a browser role.
  FOR inherited IN
    SELECT DISTINCT r.rolname AS creator, g.rolname AS grantee, b.rolname AS browser
    FROM pg_default_acl d
    JOIN pg_roles r ON r.oid = d.defaclrole
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    JOIN pg_roles g ON g.oid = a.grantee
    JOIN pg_roles b ON b.rolname IN ('anon', 'authenticated')
    WHERE r.rolname = ANY (creators)
      AND d.defaclobjtype IN ('r', 'S', 'f')
      AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
      AND g.oid <> b.oid
      AND pg_has_role(b.oid, g.oid, 'USAGE')
    ORDER BY 1, 2, 3
  LOOP
    RAISE EXCEPTION
      'Migration 0029 refuses to run: "%" inherits the default privileges that creator "%" gives "%". Revoke that default or the membership as its owner first; nothing was changed.',
      inherited.browser, inherited.creator, inherited.grantee
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END LOOP;

  -- Pass 1 proves the executor's real authority and is always rolled back.
  FOR attempt IN 1..2 LOOP
    BEGIN
      FOR entry IN
        SELECT r.rolname, x.ns, x.objtype
        FROM (
          SELECT d.defaclrole AS role_oid, d.defaclnamespace AS ns, d.defaclobjtype AS objtype
          FROM pg_default_acl d
          WHERE d.defaclobjtype IN ('r', 'S', 'f')
            AND d.defaclnamespace IN (0::oid, 'public'::regnamespace::oid)
          UNION
          SELECT oid, 0::oid, 'f'::"char" FROM pg_roles
        ) x
        JOIN pg_roles r ON r.oid = x.role_oid
        WHERE r.rolname = ANY (creators)
        ORDER BY r.rolname, x.ns, x.objtype
      LOOP
        step := format('default privileges created by role "%s"', entry.rolname);
        EXECUTE format(
          'ALTER DEFAULT PRIVILEGES FOR ROLE %I %s REVOKE ALL ON %s FROM %s',
          entry.rolname,
          CASE WHEN entry.ns = 0 THEN '' ELSE 'IN SCHEMA public' END,
          CASE entry.objtype WHEN 'r' THEN 'TABLES' WHEN 'S' THEN 'SEQUENCES' ELSE 'FUNCTIONS' END,
          grantees
        );
      END LOOP;

      FOREACH table_name IN ARRAY ARRAY[
        'calculation_versions', 'card_meanings', 'cards', 'content_versions', 'decks',
        'payment_webhook_events', 'products', 'prompt_versions', 'spread_positions', 'spreads'
      ]
      LOOP
        step := format('access to table public.%s', table_name);
        -- Table-level REVOKE also clears any column-level grants.
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %s', table_name, grantees);
        -- REVOKE by a non-owner with only some privilege is a WARNING no-op, so
        -- success is proven by the effective result, in the trial pass too.
        IF EXISTS (
          SELECT 1
          FROM pg_class c
          CROSS JOIN pg_roles b
          WHERE c.oid = format('public.%I', table_name)::regclass
            AND b.rolname IN ('anon', 'authenticated')
            AND (
              has_table_privilege(b.oid, c.oid,
                'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER' ||
                CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END)
              OR has_any_column_privilege(b.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
              OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
            )
        ) THEN
          RAISE EXCEPTION 'REVOKE left a browser-role or PUBLIC privilege (no-op, or granted by another role)'
            USING ERRCODE = 'insufficient_privilege';
        END IF;
        FOR sequence_name IN
          SELECT d.objid::regclass::text
          FROM pg_depend d
          JOIN pg_class s ON s.oid = d.objid AND s.relkind = 'S'
          WHERE d.refobjid = format('public.%I', table_name)::regclass
            AND d.deptype IN ('a', 'i')
        LOOP
          step := format('access to sequence %s', sequence_name);
          EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM %s', sequence_name, grantees);
          IF EXISTS (
            SELECT 1
            FROM pg_class c
            CROSS JOIN pg_roles b
            WHERE c.oid = sequence_name::regclass
              AND b.rolname IN ('anon', 'authenticated')
              AND (
                has_sequence_privilege(b.oid, c.oid, 'USAGE, SELECT, UPDATE')
                OR EXISTS (SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
              )
          ) THEN
            RAISE EXCEPTION 'REVOKE left a browser-role or PUBLIC privilege (no-op, or granted by another role)'
              USING ERRCODE = 'insufficient_privilege';
          END IF;
        END LOOP;
      END LOOP;

      IF attempt = 1 THEN
        RAISE EXCEPTION 'authority verified' USING ERRCODE = 'S0029';
      END IF;
    EXCEPTION
      WHEN SQLSTATE 'S0029' THEN
        NULL;
      WHEN insufficient_privilege THEN
        GET STACKED DIAGNOSTICS detail = MESSAGE_TEXT;
        RAISE EXCEPTION
          'Migration 0029 cannot change %: % (executor %). Re-run as a role that owns these objects or inherits the creators'' privileges; nothing was changed.',
          step, detail, current_user
          USING ERRCODE = 'insufficient_privilege';
    END;
  END LOOP;

  -- Effective check over the frozen set: a new object from any creator must be
  -- unreachable by a browser role through the global default (or the built-in
  -- one when absent), the public-schema default, PUBLIC or inheritance.
  IF EXISTS (
    SELECT 1
    FROM unnest(creators) AS c(name)
    JOIN pg_roles cr ON cr.rolname = c.name
    CROSS JOIN (VALUES ('r'::"char"), ('S'::"char"), ('f'::"char")) AS k(objtype)
    CROSS JOIN pg_roles b
    CROSS JOIN LATERAL (
      SELECT a.grantee
      FROM pg_default_acl d
      CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = cr.oid AND d.defaclobjtype = k.objtype
        AND d.defaclnamespace = 'public'::regnamespace::oid
      UNION ALL
      SELECT a.grantee
      FROM aclexplode(coalesce(
        (SELECT d.defaclacl FROM pg_default_acl d
         WHERE d.defaclrole = cr.oid AND d.defaclobjtype = k.objtype AND d.defaclnamespace = 0),
        acldefault(k.objtype, cr.oid))) a
    ) g
    WHERE b.rolname IN ('anon', 'authenticated')
      AND CASE WHEN g.grantee = 0 THEN true ELSE pg_has_role(b.oid, g.grantee, 'USAGE') END
  ) THEN
    RAISE EXCEPTION 'A creator default still leaves new tables, sequences or functions reachable by a browser role';
  END IF;
END
$default_privileges$;--> statement-breakpoint

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
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER' ||
          CASE WHEN current_setting('server_version_num')::int >= 170000 THEN ', MAINTAIN' ELSE '' END)
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
END
$guard$;
