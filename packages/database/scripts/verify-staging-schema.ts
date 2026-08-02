import { createDatabaseClient } from "../src/postgres-client";
import { record, requiredEnv } from "./staging-result";

/**
 * Confirms the authoritative Drizzle history is applied to the connected staging
 * database and that every user-owned table carries forced row level security.
 *
 * `packages/database/migrations` is the only migration authority; this script
 * asserts the applied state and never creates or alters schema itself.
 */
const EXPECTED_MIGRATIONS = ["0000_busy_centennial", "0001_supabase_staging"] as const;

const USER_OWNED_TABLES = [
  "users",
  "user_settings",
  "consents",
  "birth_profiles",
  "profile_snapshots",
  "profile_components",
  "profile_traits",
  "reading_sessions",
  "reading_draws",
  "reading_outputs",
  "follow_up_questions",
  "reading_feedback",
  "orders",
  "entitlements",
  "reports",
  "report_sections",
  "audit_events",
] as const;

async function main(): Promise<void> {
  const sql = createDatabaseClient(requiredEnv("DATABASE_URL"));
  let failed = false;

  try {
    const applied = await sql<{ id: number }[]>`
      select id from drizzle.__drizzle_migrations order by id`;
    const appliedCount = applied.length;
    const migrationsOk = appliedCount === EXPECTED_MIGRATIONS.length;
    if (!migrationsOk) failed = true;
    record({
      section: "Migrations",
      check: "Authoritative Drizzle history applied",
      status: migrationsOk ? "pass" : "fail",
      detail: migrationsOk
        ? `${appliedCount} applied: ${EXPECTED_MIGRATIONS.join(", ")}`
        : `expected ${EXPECTED_MIGRATIONS.length} applied entries, found ${appliedCount}`,
    });

    const missingTables = await sql<{ name: string }[]>`
      select required.name from unnest(${sql.array(
        USER_OWNED_TABLES as unknown as string[],
      )}::text[]) as required(name)
      where to_regclass('public.' || quote_ident(required.name)) is null`;
    const tablesOk = missingTables.length === 0;
    if (!tablesOk) failed = true;
    record({
      section: "Migrations",
      check: "User-owned tables present",
      status: tablesOk ? "pass" : "fail",
      detail: tablesOk
        ? `${USER_OWNED_TABLES.length} of ${USER_OWNED_TABLES.length} present`
        : `${missingTables.length} table(s) absent`,
    });

    const unforced = await sql<{ name: string }[]>`
      select required.name from unnest(${sql.array(
        USER_OWNED_TABLES as unknown as string[],
      )}::text[]) as required(name)
      where not exists (
        select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = required.name
          and c.relrowsecurity and c.relforcerowsecurity)`;
    const rlsOk = unforced.length === 0;
    if (!rlsOk) failed = true;
    record({
      section: "Row level security",
      check: "Forced RLS on every user-owned table",
      status: rlsOk ? "pass" : "fail",
      detail: rlsOk
        ? `${USER_OWNED_TABLES.length} of ${USER_OWNED_TABLES.length} forced`
        : `${unforced.length} table(s) missing forced RLS`,
    });

    const [policies] = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_policies where schemaname = 'public'`;
    const policiesOk = (policies?.count ?? 0) >= USER_OWNED_TABLES.length;
    if (!policiesOk) failed = true;
    record({
      section: "Row level security",
      check: "User-scoping policies present",
      status: policiesOk ? "pass" : "fail",
      detail: `${policies?.count ?? 0} policies on public schema`,
    });

    const [webhook] = await sql<{ granted: boolean }[]>`
      select has_table_privilege('authenticated', 'public.payment_webhook_events', 'select')
        as granted`;
    const webhookOk = webhook?.granted === false;
    if (!webhookOk) failed = true;
    record({
      section: "Row level security",
      check: "Webhook table withheld from the authenticated role",
      status: webhookOk ? "pass" : "fail",
      detail: webhookOk
        ? "payment_webhook_events is service-only"
        : "payment_webhook_events is readable by authenticated",
    });

    let actorOk = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claim.sub', ${"00000000-0000-4000-8000-000000000000"}, true)`;
        await tx`select id from users limit 1`;
      });
      actorOk = true;
    } catch {
      actorOk = false;
    }
    if (!actorOk) failed = true;
    record({
      section: "Row level security",
      check: "Authenticated-role transaction available",
      status: actorOk ? "pass" : "fail",
      detail: actorOk
        ? "set local role authenticated with a verified subject succeeded"
        : "the connection role cannot assume the authenticated role",
    });
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (failed) process.exitCode = 1;
}

await main();
