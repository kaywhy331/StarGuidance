import type { DatabaseClient } from "../src/postgres-client";
import { record } from "./staging-result";

/**
 * Explains why Supabase Auth refuses to create an identity.
 *
 * GoTrue answers a failed signup with `unexpected_failure` and nothing else; the
 * real reason is a Postgres error inside its transaction, visible only in hosted
 * logs this workflow cannot read. Migration 0002 removed the synchronisation
 * trigger that caused the original failure, and identity creation still failed,
 * so the cause has to be established from the database itself rather than
 * guessed at one protected run per hypothesis.
 *
 * Everything here is read-only apart from one insert that is always rolled back.
 * Only object names, error codes, and counts are recorded — never a row, an
 * address, or a credential.
 */
const APPLICATION_TRIGGER_REASON =
  "no application trigger may write to public.users; provisioning is the requireUser() boundary";

interface PostgresFailure {
  readonly code: string;
  readonly message: string;
}

function describe(error: unknown): PostgresFailure {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown; detail?: unknown };
    return {
      code: typeof candidate.code === "string" ? candidate.code : "unknown",
      // Postgres quotes offending values in `detail`; only the message is kept,
      // and the recorder redacts anything that still looks identifying.
      message: typeof candidate.message === "string" ? candidate.message : "unknown error",
    };
  }
  return { code: "unknown", message: "unknown error" };
}

/**
 * Reports every user-defined trigger on auth.users. Foreign keys are implemented
 * as internal triggers, so those are excluded: they are expected and are not
 * what breaks a signup.
 */
async function reportAuthTriggers(sql: DatabaseClient): Promise<boolean> {
  const triggers = await sql<{ name: string; routine: string }[]>`
    select t.tgname as name, p.proname as routine
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
    order by t.tgname`;

  const clean = triggers.length === 0;
  record({
    section: "Auth diagnostics",
    check: "No application trigger remains on the Auth users table",
    status: clean ? "pass" : "fail",
    detail: clean
      ? APPLICATION_TRIGGER_REASON
      : `${triggers.length} unexpected trigger(s): ` +
        triggers.map(({ name, routine }) => `${name} -> ${routine}()`).join(", "),
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

/**
 * Performs the insert GoTrue performs, then rolls it back.
 *
 * A trigger, constraint, or privilege problem surfaces here as a precise
 * Postgres error instead of GoTrue's opaque `unexpected_failure`.
 */
async function probeAuthInsert(sql: DatabaseClient, subjectId: string): Promise<void> {
  let outcome: PostgresFailure | undefined;
  try {
    await sql.begin(async (tx) => {
      await tx`insert into auth.users (id, email)
        values (${subjectId}, ${`sg-verify-probe-${subjectId}@starguidance.test`})`;
      // Never keep it: this probe must leave the Auth schema exactly as found.
      throw new Error("SG_ROLLBACK");
    });
  } catch (error) {
    const failure = describe(error);
    if (failure.message !== "SG_ROLLBACK") outcome = failure;
  }

  // A not-null violation means this probe omitted a column GoTrue always
  // supplies, not that the table rejects new rows. Reporting that as a failure
  // would point the investigation at the wrong place.
  const inconclusive = outcome?.code === "23502";
  record({
    section: "Auth diagnostics",
    check: "A direct insert into the Auth users table succeeds",
    status: !outcome ? "pass" : inconclusive ? "limited" : "fail",
    detail: !outcome
      ? "the insert succeeded and was rolled back, so the Auth table itself accepts new rows"
      : inconclusive
        ? `inconclusive: this minimal probe omitted a required column (${outcome.message})`
        : `rejected with ${outcome.code}: ${outcome.message}`,
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
  await probeAuthInsert(sql, subjectId);
  return triggersClean;
}
