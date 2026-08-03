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
  return triggersClean;
}
