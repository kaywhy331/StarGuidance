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
          'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER' ||
          case when current_setting('server_version_num')::int >= 170000 then ', MAINTAIN' else '' end)
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
 * Creator-role default ACL entries (global or `IN SCHEMA public`) that reach a
 * browser role on the next table, sequence or function: the browser role named
 * directly, PUBLIC, or a group role a browser role inherits (reported by the
 * group's name).
 */
export async function findBrowserDefaultAcls(sql: DatabaseClient): Promise<BrowserDefaultAcl[]> {
  return sql<BrowserDefaultAcl[]>`
    select distinct creator.rolname as creator,
      case when d.defaclnamespace = 0 then 'global' else 'public' end as scope,
      case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence' else 'function' end
        as "objectType",
      coalesce(grantee.rolname, 'PUBLIC') as grantee
    from pg_default_acl d
    join pg_roles creator on creator.oid = d.defaclrole
    cross join lateral aclexplode(d.defaclacl) a
    left join pg_roles grantee on grantee.oid = a.grantee
    cross join pg_roles b
    where d.defaclobjtype in ('r', 'S', 'f')
      and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
      and b.rolname in ('anon', 'authenticated')
      and case when a.grantee = 0 then true else pg_has_role(b.oid, a.grantee, 'USAGE') end
    order by creator, scope, "objectType", grantee`;
}

export interface BrowserFutureAccess {
  readonly creator: string;
  readonly objectType: "table" | "sequence" | "function";
  readonly role: string;
}

/**
 * Effective check, over the creators migration 0029 freezes (`postgres`,
 * `supabase_admin` and every role with a global or `IN SCHEMA public` default
 * row; the migration leaves a global function row for each, so this scope
 * survives the removal of browser grants). Reports the browser roles that would
 * reach a NEW object: from the global default (PostgreSQL's built-in one when
 * absent, which includes PUBLIC EXECUTE) plus the public-schema default,
 * directly, through PUBLIC, or by inheritance.
 */
export async function findBrowserFutureObjectAccess(
  sql: DatabaseClient,
): Promise<BrowserFutureAccess[]> {
  return sql<BrowserFutureAccess[]>`
    with creators as (
      select r.oid, r.rolname from pg_roles r
      where r.rolname in ('postgres', 'supabase_admin')
         or exists (
           select 1 from pg_default_acl d
           where d.defaclrole = r.oid and d.defaclobjtype in ('r', 'S', 'f')
             and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
         )
    )
    select distinct cr.rolname as creator,
      case k.objtype when 'r' then 'table' when 'S' then 'sequence' else 'function' end
        as "objectType",
      b.rolname as role
    from creators cr
    cross join (values ('r'::"char"), ('S'::"char"), ('f'::"char")) as k(objtype)
    cross join pg_roles b
    cross join lateral (
      select a.grantee
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
      where d.defaclrole = cr.oid and d.defaclobjtype = k.objtype
        and d.defaclnamespace = 'public'::regnamespace::oid
      union all
      select a.grantee
      from aclexplode(coalesce(
        (select d.defaclacl from pg_default_acl d
         where d.defaclrole = cr.oid and d.defaclobjtype = k.objtype and d.defaclnamespace = 0),
        acldefault(k.objtype, cr.oid))) a
    ) g
    where b.rolname in ('anon', 'authenticated')
      and case when g.grantee = 0 then true else pg_has_role(b.oid, g.grantee, 'USAGE') end
    order by creator, "objectType", role`;
}

/**
 * Creators whose next function a browser role can execute, whether through
 * implicit or explicit PUBLIC EXECUTE (global or per-schema), a named grant or
 * an inherited group. Derived from {@link findBrowserFutureObjectAccess}.
 */
export async function findPublicFunctionDefaultGaps(sql: DatabaseClient): Promise<string[]> {
  const rows = await findBrowserFutureObjectAccess(sql);
  return [
    ...new Set(rows.filter((row) => row.objectType === "function").map((row) => row.creator)),
  ];
}
