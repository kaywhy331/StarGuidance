import type { DatabaseClient } from "./postgres-client";

/**
 * Supabase maps unauthenticated and signed-in browsers to these roles. The web
 * application uses Supabase for Auth only, so neither needs direct table access.
 */
export const BROWSER_ROLES = ["anon", "authenticated"] as const;

/**
 * The application DDL creator is explicitly `postgres` (the observed hosted
 * migration identity), not whichever roles the executor could administer.
 * Migration 0029 changes only this creator's default privileges; every other
 * creator (notably `supabase_admin`) is a reported, unchanged platform residual.
 */
export const APPLICATION_CREATOR = "postgres";

export interface ApplicationCreatorIdentity {
  readonly sessionUser: string;
  readonly currentUser: string;
}

/**
 * Why a connection may not run application DDL, or undefined when it may.
 * PostgreSQL applies the default privileges of the CURRENT role to what it
 * creates, so a separate login (even one that inherits `postgres`) would create
 * objects it owns under its own, built-in defaults. A login that ran
 * `SET ROLE postgres` would in fact create postgres-owned objects with the
 * postgres defaults; it is refused only as a stricter direct-login policy: both
 * session_user and current_user must be the application creator.
 */
export function applicationCreatorRefusal(
  identity: ApplicationCreatorIdentity,
): string | undefined {
  if (
    identity.sessionUser === APPLICATION_CREATOR &&
    identity.currentUser === APPLICATION_CREATOR
  ) {
    return undefined;
  }
  return `application DDL must run as a direct "${APPLICATION_CREATOR}" connection (session_user "${identity.sessionUser}", current_user "${identity.currentUser}")`;
}

/** Reads the identity of the connection itself; no state is changed. */
export async function readApplicationCreatorIdentity(
  sql: DatabaseClient,
): Promise<ApplicationCreatorIdentity> {
  const [row] = await sql<{ sessionUser: string; currentUser: string }[]>`
    select session_user::text as "sessionUser", current_user::text as "currentUser"`;
  return { sessionUser: row?.sessionUser ?? "", currentUser: row?.currentUser ?? "" };
}

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

/** `application` is {@link APPLICATION_CREATOR}; `platform` is every other creator (unchanged by 0029). */
export type CreatorOrigin = "application" | "platform";

export interface BrowserTableAccess {
  readonly role: string;
  readonly table: string;
  /**
   * `application` for every table in {@link BROWSER_WITHHELD_TABLES} (whoever owns it
   * now) and for any other table owned by the application creator; `platform` for
   * unrelated tables owned by another role.
   */
  readonly origin: CreatorOrigin;
}

export interface BrowserDefaultAcl {
  readonly creator: string;
  readonly origin: CreatorOrigin;
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
  origin?: CreatorOrigin,
): Promise<BrowserTableAccess[]> {
  const rows = await sql<BrowserTableAccess[]>`
    select r.rolname as role, c.relname as table,
      case when c.relname = any(${sql.array(BROWSER_WITHHELD_TABLES as unknown as string[])}::text[])
          or c.relowner = (select oid from pg_roles where rolname = ${APPLICATION_CREATOR})
        then 'application' else 'platform' end as origin
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
  return origin ? rows.filter((row) => row.origin === origin) : [...rows];
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
 * Required tables whose owner is not the application creator. Migration 0029
 * assumes `postgres` owns them (it fails closed otherwise), so drift is reported
 * even when no browser grant exists yet.
 */
export async function findWithheldTableOwnershipDrift(sql: DatabaseClient): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select c.relname as name
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname = any(${sql.array(BROWSER_WITHHELD_TABLES as unknown as string[])}::text[])
      and c.relowner is distinct from (select oid from pg_roles where rolname = ${APPLICATION_CREATOR})
    order by c.relname`;
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
      case when creator.rolname = ${APPLICATION_CREATOR} then 'application' else 'platform' end
        as origin,
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
    order by creator, origin, scope, "objectType", grantee`;
}

export interface BrowserFutureAccess {
  readonly creator: string;
  readonly origin: CreatorOrigin;
  readonly objectType: "table" | "sequence" | "function";
  readonly role: string;
}

/**
 * Effective check over every auditable creator: the application creator,
 * `supabase_admin` and every role with a global or `IN SCHEMA public` default
 * row. Only `origin: "application"` rows are in migration 0029's scope;
 * `platform` rows are residual exposure it does not change. Reports the browser roles that would
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
      where r.rolname in (${APPLICATION_CREATOR}, 'supabase_admin')
         or exists (
           select 1 from pg_default_acl d
           where d.defaclrole = r.oid and d.defaclobjtype in ('r', 'S', 'f')
             and d.defaclnamespace in (0::oid, 'public'::regnamespace::oid)
         )
    )
    select distinct cr.rolname as creator,
      case when cr.rolname = ${APPLICATION_CREATOR} then 'application' else 'platform' end
        as origin,
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
export async function findPublicFunctionDefaultGaps(
  sql: DatabaseClient,
  origin?: CreatorOrigin,
): Promise<string[]> {
  const rows = await findBrowserFutureObjectAccess(sql);
  return [
    ...new Set(
      rows
        .filter((row) => row.objectType === "function" && (!origin || row.origin === origin))
        .map((row) => row.creator),
    ),
  ];
}

export interface BrowserBoundaryAudit {
  readonly missingTables: string[];
  /** Required tables no longer owned by the application creator (fails closed). */
  readonly ownershipDrift: string[];
  /** Browser-reachable unforced tables owned by the application creator. */
  readonly reachableTables: BrowserTableAccess[];
  /** Browser-reachable unforced tables owned by another role (platform residual). */
  readonly platformReachableTables: BrowserTableAccess[];
  /** Application-creator defaults and effective future access. */
  readonly applicationDefaults: BrowserDefaultAcl[];
  readonly applicationFutureAccess: BrowserFutureAccess[];
  /** Other creators (e.g. supabase_admin): not changed by 0029, reported separately. */
  readonly platformDefaults: BrowserDefaultAcl[];
  readonly platformFutureAccess: BrowserFutureAccess[];
  /** True only for the application scope. */
  readonly applicationScopeClean: boolean;
  /** True when other creators still expose new objects or defaults to a browser role. */
  readonly platformResidualPresent: boolean;
  /** Application scope clean AND no platform residual; never inferred from the first. */
  readonly globallyClean: boolean;
}

/**
 * Application-scope result plus a separate platform residual status. Callers
 * must not treat `applicationScopeClean` as a globally clean result.
 */
export async function auditBrowserBoundary(sql: DatabaseClient): Promise<BrowserBoundaryAudit> {
  const missingTables = await findMissingWithheldTables(sql);
  const ownershipDrift = await findWithheldTableOwnershipDrift(sql);
  const allReachable = await findBrowserReachableUnforcedTables(sql);
  const reachableTables = allReachable.filter((row) => row.origin === "application");
  const platformReachableTables = allReachable.filter((row) => row.origin === "platform");
  const defaults = await findBrowserDefaultAcls(sql);
  const future = await findBrowserFutureObjectAccess(sql);
  const applicationDefaults = defaults.filter((row) => row.origin === "application");
  const platformDefaults = defaults.filter((row) => row.origin === "platform");
  const applicationFutureAccess = future.filter((row) => row.origin === "application");
  const platformFutureAccess = future.filter((row) => row.origin === "platform");
  const applicationScopeClean =
    missingTables.length === 0 &&
    ownershipDrift.length === 0 &&
    reachableTables.length === 0 &&
    applicationDefaults.length === 0 &&
    applicationFutureAccess.length === 0;
  const platformResidualPresent =
    platformDefaults.length > 0 ||
    platformFutureAccess.length > 0 ||
    platformReachableTables.length > 0;
  return {
    missingTables,
    ownershipDrift,
    reachableTables,
    platformReachableTables,
    applicationDefaults,
    applicationFutureAccess,
    platformDefaults,
    platformFutureAccess,
    applicationScopeClean,
    platformResidualPresent,
    globallyClean: applicationScopeClean && !platformResidualPresent,
  };
}
