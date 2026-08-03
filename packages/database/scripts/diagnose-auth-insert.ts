import type { DatabaseClient } from "../src/postgres-client";
import { record } from "./staging-result";

/**
 * Explains why Supabase Auth refuses to create an identity.
 *
 * GoTrue answers a failed signup with `unexpected_failure` and nothing else; the
 * real reason is a Postgres error inside its transaction, visible only in hosted
 * logs this workflow cannot read. Migration 0002 removed the synchronisation
 * trigger that caused the original failure and identity creation still failed,
 * so the cause has to be established from the database itself.
 *
 * A first pass proved the schema accepts a minimal insert into `auth.users` as
 * the migration role, which narrowed the problem rather than solving it: GoTrue
 * connects as `supabase_auth_admin`, writes several tables in one transaction,
 * and a trigger anywhere in the `auth` schema participates. This pass therefore
 * reproduces that sequence in that role wherever the connection permits it.
 *
 * Everything here is read-only apart from inserts that are always rolled back.
 * Only object names, column names, error codes, and counts are recorded — never
 * a row, an address, or a credential.
 */
const GOTRUE_ROLE = "supabase_auth_admin";

interface PostgresFailure {
  readonly code: string;
  readonly message: string;
}

function describe(error: unknown): PostgresFailure {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : "unknown",
      message: typeof candidate.message === "string" ? candidate.message : "unknown error",
    };
  }
  return { code: "unknown", message: "unknown error" };
}

/**
 * Reports every user-defined trigger anywhere in the `auth` schema.
 *
 * The earlier pass looked only at `auth.users`, which cannot see a trigger on
 * `auth.identities` — and GoTrue writes that table in the same transaction.
 * Foreign keys are excluded: those are internal triggers and are expected.
 */
async function reportAuthTriggers(sql: DatabaseClient): Promise<boolean> {
  const triggers = await sql<{ table_name: string; name: string; routine: string }[]>`
    select c.relname as table_name, t.tgname as name, p.proname as routine
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'auth' and not t.tgisinternal
    order by c.relname, t.tgname`;

  const clean = triggers.length === 0;
  record({
    section: "Auth diagnostics",
    check: "No application trigger remains anywhere in the Auth schema",
    status: clean ? "pass" : "fail",
    detail: clean
      ? "no user-defined trigger on any auth table; provisioning is the requireUser() boundary"
      : `${triggers.length} unexpected trigger(s): ` +
        triggers.map((t) => `${t.table_name}.${t.name} -> ${t.routine}()`).join(", "),
  });
  return clean;
}

/** Reports SECURITY DEFINER routines in public, which bypass caller identity. */
async function reportSecurityDefiners(sql: DatabaseClient): Promise<void> {
  const routines = await sql<{ name: string }[]>`
    select p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
    order by p.proname`;
  record({
    section: "Auth diagnostics",
    check: "SECURITY DEFINER routines in the public schema",
    status: routines.length === 0 ? "pass" : "limited",
    detail:
      routines.length === 0
        ? "none: no routine runs with an identity other than its caller's"
        : `${routines.length} present: ${routines.map(({ name }) => name).join(", ")}`,
  });
}

async function columnsOf(sql: DatabaseClient, table: string): Promise<Set<string>> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = ${table}`;
  return new Set(rows.map(({ column_name }) => column_name));
}

/** Whether the connection may assume GoTrue's role, so the probe is faithful. */
async function canAssumeGotrueRole(sql: DatabaseClient): Promise<boolean> {
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${GOTRUE_ROLE}`);
      await tx`select 1`;
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Performs the write sequence GoTrue performs — `auth.users` then
 * `auth.identities` — in GoTrue's own role where possible, then rolls back.
 *
 * A trigger, constraint, privilege, or schema-drift problem surfaces here as a
 * precise Postgres error instead of GoTrue's opaque `unexpected_failure`.
 */
async function probeSignupSequence(sql: DatabaseClient, subjectId: string): Promise<void> {
  const asGotrue = await canAssumeGotrueRole(sql);
  const identityColumns = await columnsOf(sql, "identities");

  record({
    section: "Auth diagnostics",
    check: "Auth identities table shape",
    status: identityColumns.size > 0 ? "pass" : "fail",
    detail:
      identityColumns.size > 0
        ? `${identityColumns.size} columns: ${[...identityColumns].sort().join(", ")}`
        : "auth.identities has no readable columns",
  });

  let stage = "auth.users";
  let outcome: PostgresFailure | undefined;
  try {
    await sql.begin(async (tx) => {
      if (asGotrue) await tx.unsafe(`set local role ${GOTRUE_ROLE}`);
      await tx`insert into auth.users (id, email, aud, role)
        values (${subjectId}, ${`sg-verify-probe-${subjectId}@starguidance.test`},
                'authenticated', 'authenticated')`;

      stage = "auth.identities";
      // Built from the columns that actually exist, so a version difference is
      // reported as a real failure rather than manufactured by this probe.
      const identityData = tx.json({
        sub: subjectId,
        email: `sg-verify-probe-${subjectId}@starguidance.test`,
      });
      if (identityColumns.has("provider_id")) {
        await tx`insert into auth.identities (user_id, provider, provider_id, identity_data)
          values (${subjectId}, 'email', ${subjectId}, ${identityData})`;
      } else {
        await tx`insert into auth.identities (user_id, provider, identity_data)
          values (${subjectId}, 'email', ${identityData})`;
      }

      stage = "rollback";
      throw new Error("SG_ROLLBACK");
    });
  } catch (error) {
    const failure = describe(error);
    if (failure.message !== "SG_ROLLBACK") outcome = failure;
  }

  const inconclusive = outcome?.code === "23502";
  record({
    section: "Auth diagnostics",
    check: `The Auth signup write sequence succeeds${asGotrue ? ` as ${GOTRUE_ROLE}` : ""}`,
    status: !outcome ? "pass" : inconclusive ? "limited" : "fail",
    detail: !outcome
      ? `inserted into auth.users and auth.identities${asGotrue ? ` as ${GOTRUE_ROLE}` : " as the migration role"} and rolled back`
      : inconclusive
        ? `inconclusive at ${stage}: this probe omitted a required column (${outcome.message})`
        : `rejected at ${stage} with ${outcome.code}: ${outcome.message}`,
  });

  if (!asGotrue)
    record({
      section: "Auth diagnostics",
      check: "Probe ran in GoTrue's own role",
      status: "limited",
      detail:
        `the connection cannot assume ${GOTRUE_ROLE}, so the probe ran as the migration role; ` +
        "a privilege-only difference would not be reproduced",
    });
}

/**
 * Reports what GoTrue's own role is actually allowed to do.
 *
 * The write probe can only assume that role when the connection is a member of
 * it, and on this project it is not. Catalog privilege lookups need no such
 * membership, so a missing grant is still visible.
 */
async function reportGotrueRolePrivileges(sql: DatabaseClient): Promise<void> {
  const [role] = await sql<{ present: boolean }[]>`
    select exists (select 1 from pg_roles where rolname = ${GOTRUE_ROLE}) as present`;
  if (role?.present !== true) {
    // A Supabase-managed project always has this role. Its absence means this
    // is a stand-in database, where privilege questions do not arise.
    record({
      section: "Auth diagnostics",
      check: "GoTrue role present",
      status: "limited",
      detail: `${GOTRUE_ROLE} does not exist, so this is not a Supabase-managed Auth deployment`,
    });
    return;
  }

  const tables = await sql<{ name: string; owner: string; can_insert: boolean }[]>`
    select c.relname as name,
           pg_get_userbyid(c.relowner) as owner,
           has_table_privilege(${GOTRUE_ROLE}, c.oid, 'INSERT') as can_insert
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth' and c.relkind = 'r'
    order by c.relname`;

  const denied = tables.filter(({ can_insert }) => !can_insert);
  record({
    section: "Auth diagnostics",
    check: "GoTrue role may write every Auth table",
    status: denied.length === 0 ? "pass" : "fail",
    detail:
      denied.length === 0
        ? `${tables.length} auth table(s), all writable by ${GOTRUE_ROLE}`
        : `${denied.length} table(s) refuse INSERT to ${GOTRUE_ROLE}: ` +
          denied.map(({ name }) => name).join(", "),
  });

  const foreign = [...new Set(tables.map(({ owner }) => owner))].filter(
    (owner) => owner !== GOTRUE_ROLE,
  );
  record({
    section: "Auth diagnostics",
    check: "Auth table ownership",
    status: foreign.length === 0 ? "pass" : "limited",
    detail:
      foreign.length === 0
        ? `every auth table is owned by ${GOTRUE_ROLE}`
        : `owners other than ${GOTRUE_ROLE} present: ${foreign.join(", ")}`,
  });

  const [schema] = await sql<{ usage: boolean; create: boolean }[]>`
    select has_schema_privilege(${GOTRUE_ROLE}, 'auth', 'USAGE') as usage,
           has_schema_privilege(${GOTRUE_ROLE}, 'auth', 'CREATE') as create`;
  record({
    section: "Auth diagnostics",
    check: "GoTrue role may use the Auth schema",
    status: schema?.usage ? "pass" : "fail",
    detail: `USAGE ${schema?.usage === true}; CREATE ${schema?.create === true}`,
  });
}

/**
 * Asks the Admin API to create an identity and reports what the database shows
 * afterwards.
 *
 * Whether a row survives a failed call separates "the insert was rejected" from
 * "the insert succeeded and something after it failed" — a distinction no
 * amount of schema inspection can make, and one `unexpected_failure` hides.
 */
async function probeAdminCreate(sql: DatabaseClient): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!baseUrl || !serviceKey) {
    record({
      section: "Auth diagnostics",
      check: "Admin API identity creation",
      status: "skipped",
      detail: "the Admin API credentials were not provided to this step",
    });
    return;
  }

  const marker = `sg-verify-admindiag-${Date.now()}`;
  const email = `${marker}@starguidance.test`;
  if (process.env.GITHUB_ACTIONS === "true") process.stdout.write(`::add-mask::${email}\n`);

  let status = 0;
  let errorCode = "";
  try {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password: `Sg!${marker}-${marker}`, email_confirm: true }),
    });
    status = response.status;
    if (!response.ok) {
      const body = (await response.json()) as { error_code?: string; msg?: string };
      errorCode = body.error_code ?? body.msg?.replace(/"[^"]*"/g, "[redacted]") ?? "";
    }
  } catch {
    errorCode = "the request itself failed";
  }

  // Did any row survive the attempt?
  const [remnant] = await sql<{ users: number; identities: number }[]>`
    select
      (select count(*)::int from auth.users where email = ${email}) as users,
      (select count(*)::int from auth.identities
         where user_id in (select id from auth.users where email = ${email})) as identities`;

  record({
    section: "Auth diagnostics",
    check: "Admin API identity creation",
    status: status > 0 && status < 300 ? "pass" : "fail",
    detail:
      `status ${status}${errorCode ? ` (${errorCode})` : ""}; ` +
      `rows left behind: auth.users ${remnant?.users ?? -1}, auth.identities ${remnant?.identities ?? -1}. ` +
      (status >= 500 && (remnant?.users ?? 0) === 0
        ? "nothing was written, so the transaction was rolled back inside the provider"
        : status >= 500
          ? "a partial row survived, so the failure happened after the user row was written"
          : "created"),
  });

  // Never leave a diagnostic identity behind.
  await sql`delete from auth.users where email = ${email}`.catch(() => undefined);
}

/** Runs every Auth-side diagnostic. Returns false when one of them failed. */
export async function diagnoseAuthInsert(sql: DatabaseClient, subjectId: string): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    select to_regclass('auth.users') is not null as present`;
  if (row?.present !== true) {
    record({
      section: "Auth diagnostics",
      check: "Auth schema present",
      status: "skipped",
      detail: "this database has no auth schema, so Auth-side diagnostics do not apply",
    });
    return true;
  }

  const triggersClean = await reportAuthTriggers(sql);
  await reportSecurityDefiners(sql);
  await probeSignupSequence(sql, subjectId);
  await reportGotrueRolePrivileges(sql);
  await probeAdminCreate(sql);
  return triggersClean;
}
