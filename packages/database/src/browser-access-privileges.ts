import type { DatabaseClient } from "./postgres-client";

/**
 * Supabase maps unauthenticated and signed-in browsers to these roles. The web
 * application uses Supabase for Auth only, so neither needs direct table access.
 */
export const BROWSER_ROLES = ["anon", "authenticated"] as const;

/** Tarot, prompt, calculation and product content read by the server actor. */
export const REFERENCE_TABLES = [
  "calculation_versions",
  "card_meanings",
  "cards",
  "content_versions",
  "decks",
  "products",
  "prompt_versions",
  "spread_positions",
  "spreads",
] as const;

/** Reference tables plus the connection-role-only webhook lease/idempotency ledger. */
export const BROWSER_WITHHELD_TABLES = [...REFERENCE_TABLES, "payment_webhook_events"] as const;

export interface BrowserTableAccess {
  readonly role: string;
  readonly table: string;
}

export interface BrowserDefaultAcl {
  readonly creator: string;
  readonly scope: "global" | "public";
  readonly objectType: "table" | "sequence" | "function";
  readonly grantee: string;
}

/**
 * Public tables a browser role can reach through its effective privileges
 * (direct, PUBLIC, or inherited) without forced row level security. Forced-RLS
 * tables are bounded by their policies instead; every other table must be
 * unreachable, so a newly created table cannot reintroduce the exposure.
 */
export async function findBrowserReachableUnforcedTables(
  sql: DatabaseClient,
): Promise<BrowserTableAccess[]> {
  return sql<BrowserTableAccess[]>`
    select r.rolname as role, c.relname as table
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join pg_roles r
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and r.rolname in ('anon', 'authenticated')
      and not (c.relrowsecurity and c.relforcerowsecurity)
      and (
        has_table_privilege(r.oid, c.oid,
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
        or has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
      )
    order by c.relname, r.rolname`;
}

/** Tables from {@link BROWSER_WITHHELD_TABLES} that do not exist (a rename must fail loudly). */
export async function findMissingWithheldTables(sql: DatabaseClient): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select required.name from unnest(${sql.array(
      BROWSER_WITHHELD_TABLES as unknown as string[],
    )}::text[]) as required(name)
    where to_regclass('public.' || quote_ident(required.name)) is null`;
  return rows.map(({ name }) => name);
}

/**
 * Creator-role default ACLs (global or `IN SCHEMA public`) that would grant a
 * browser role access to the next table, sequence or function created.
 */
export async function findBrowserDefaultAcls(sql: DatabaseClient): Promise<BrowserDefaultAcl[]> {
  return sql<BrowserDefaultAcl[]>`
    select creator.rolname as creator,
      case when d.defaclnamespace = 0 then 'global' else 'public' end as scope,
      case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence' else 'function' end
        as "objectType",
      grantee.rolname as grantee
    from pg_default_acl d
    join pg_roles creator on creator.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) a
    join pg_roles grantee on grantee.oid = a.grantee
    where d.defaclobjtype in ('r', 'S', 'f')
      and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
      and grantee.rolname in ('anon', 'authenticated')
    order by creator.rolname, scope, "objectType", grantee.rolname`;
}

/**
 * Creators (the platform's `postgres`/`supabase_admin`, or any creator whose
 * defaults list a browser role) whose creator-global function default still
 * grants implicit or explicit PUBLIC EXECUTE. `anon` and `authenticated`
 * inherit PUBLIC, so every function such a creator makes next is browser
 * callable even when no default ACL names a browser role.
 */
export async function findPublicFunctionDefaultGaps(sql: DatabaseClient): Promise<string[]> {
  const rows = await sql<{ creator: string }[]>`
    select r.rolname as creator
    from pg_roles r
    where (
        r.rolname in ('postgres', 'supabase_admin')
        or exists (
          select 1 from pg_default_acl x
          where x.defaclrole = r.oid and x.defaclobjtype = 'f'
            and x.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
        )
      )
      and not exists (
        select 1 from pg_default_acl d
        where d.defaclrole = r.oid and d.defaclobjtype = 'f' and d.defaclnamespace = 0
          and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)
      )
    order by r.rolname`;
  return rows.map(({ creator }) => creator);
}
