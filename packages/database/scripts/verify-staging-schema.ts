import { randomUUID } from "node:crypto";

import { APPLICATION_DATABASE_ROLE } from "../src/database-role";
import { EXPECTED_MIGRATIONS } from "../src/migration-manifest";
import { createDatabaseClient } from "../src/postgres-client";
import { diagnoseAuthInsert } from "./diagnose-auth-insert";
import { completeStage, record, requiredEnv } from "./staging-result";

/**
 * Confirms the authoritative Drizzle history is applied to the connected staging
 * database and that every user-owned table carries forced row level security.
 *
 * `packages/database/migrations` is the only migration authority; this script
 * asserts the applied state and never creates or alters schema itself.
 */
/**
 * App-only tables carry a user_id-free or cross-user workload (rate-limit
 * buckets keyed by opaque hash; the interpretation/report job queues' claim sweeps),
 * so they are absent from USER_OWNED_TABLES' per-subject policy shape — but
 * they must still be forced-RLS and unreachable from any browser role, and
 * both job queues' application-role policies must be subject-bound rather
 * than permissive.
 */
const APP_ONLY_TABLES = [
  "interpretation_jobs",
  "report_jobs",
  "rate_limit_buckets",
  "deletion_receipts",
  "product_events",
  "runtime_configuration_versions",
] as const;

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
  // Two independent mandatory stages are proved here; each marks itself only if
  // all of its own checks passed.
  let syncRemovalProved = false;
  let forcedRlsProved = false;

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

    // Migration 0002 removed the SECURITY DEFINER trigger that forced RLS made
    // unusable. Its return would break Supabase Auth signup again, so absence is
    // asserted directly rather than inferred from the migration count.
    const [trigger] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth' and c.relname = 'users'
        and t.tgname = 'sync_authenticated_user_after_insert'`;
    const [routine] = await sql<{ count: number }[]>`
      select count(*)::int as count
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sync_authenticated_user'`;
    const syncRemoved = (trigger?.count ?? -1) === 0 && (routine?.count ?? -1) === 0;
    if (!syncRemoved) failed = true;
    record({
      section: "Migrations",
      check: "auth.users synchronisation trigger and function removed",
      status: syncRemoved ? "pass" : "fail",
      detail: syncRemoved
        ? "no sync trigger and no sync function remain; provisioning is the application boundary"
        : `trigger present ${(trigger?.count ?? 0) > 0}; function present ${(routine?.count ?? 0) > 0}`,
    });

    // The cascade is now the only link from an Auth identity to application data.
    const [cascade] = await sql<{ count: number }[]>`
      select count(*)::int as count from pg_constraint
      where conname = 'users_auth_user_id_fk'
        and conrelid = 'public.users'::regclass
        and confdeltype = 'c'`;
    const cascadeOk = (cascade?.count ?? 0) === 1;
    if (!cascadeOk) failed = true;
    record({
      section: "Migrations",
      check: "Auth foreign key retains ON DELETE CASCADE",
      status: cascadeOk ? "pass" : "fail",
      // Written without a dotted three-part name on purpose: the recorder's
      // hostname redaction would otherwise mistake it for a domain and publish
      // the row as "[redacted] references ...".
      detail: cascadeOk
        ? "the users foreign key onto the Auth schema is ON DELETE CASCADE"
        : "the cascading foreign key onto the Auth schema is absent",
    });
    // Removing our own trigger is not the same as proving nothing else writes
    // to public.users behind the application's back, which is what an opaque
    // GoTrue `unexpected_failure` would otherwise leave unexplained.
    const authDiagnosticsClean = await diagnoseAuthInsert(sql, randomUUID());
    if (!authDiagnosticsClean) failed = true;
    syncRemovalProved = migrationsOk && syncRemoved && cascadeOk && authDiagnosticsClean;

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

    const missingOutputProvenance = await sql<{ table_name: string; column_name: string }[]>`
      select required.table_name, required.column_name
      from (values
        ('reading_outputs', 'safety_policy_version'),
        ('follow_up_questions', 'provider_id'),
        ('follow_up_questions', 'prompt_version'),
        ('follow_up_questions', 'content_version'),
        ('follow_up_questions', 'safety_policy_version'),
        ('follow_up_questions', 'schema_version')
      ) as required(table_name, column_name)
      where not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and columns.table_name = required.table_name
          and columns.column_name = required.column_name
      )`;
    const outputProvenanceOk = missingOutputProvenance.length === 0;
    if (!outputProvenanceOk) failed = true;
    record({
      section: "Migrations",
      check: "Primary and follow-up output provenance columns present",
      status: outputProvenanceOk ? "pass" : "fail",
      detail: outputProvenanceOk
        ? "all 6 provenance coordinates are present"
        : `${missingOutputProvenance.length} provenance column(s) absent`,
    });

    const versionedReferenceConstraints = await sql<{ name: string; definition: string }[]>`
      select conname as name, pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'cards_id_deck_version_pk',
        'spreads_id_version_pk',
        'card_meanings_card_deck_fk',
        'spread_positions_spread_version_fk',
        'reading_sessions_spread_version_fk'
      ) and connamespace = 'public'::regnamespace`;
    const normalizedReferenceConstraints = new Map(
      versionedReferenceConstraints.map(({ name, definition }) => [
        name,
        definition.replaceAll('"', "").replace(/\s+/g, " ").toLowerCase(),
      ]),
    );
    const expectedReferenceConstraints = new Map([
      ["cards_id_deck_version_pk", "primary key (id, deck_version)"],
      ["spreads_id_version_pk", "primary key (id, version)"],
      ["card_meanings_card_deck_fk", "foreign key (card_id, deck_version)"],
      ["spread_positions_spread_version_fk", "foreign key (spread_id, spread_version)"],
      ["reading_sessions_spread_version_fk", "foreign key (spread_id, spread_version)"],
    ]);
    const referenceConstraintsOk = [...expectedReferenceConstraints].every(
      ([name, prefix]) => normalizedReferenceConstraints.get(name)?.startsWith(prefix) === true,
    );
    const missingReferenceColumns = await sql<{ table_name: string; column_name: string }[]>`
      select required.table_name, required.column_name
      from (values
        ('card_meanings', 'deck_version'),
        ('spread_positions', 'spread_version')
      ) as required(table_name, column_name)
      where not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and columns.table_name = required.table_name
          and columns.column_name = required.column_name
          and columns.is_nullable = 'NO'
      )`;
    const versionedReferenceSchemaOk =
      referenceConstraintsOk && missingReferenceColumns.length === 0;
    if (!versionedReferenceSchemaOk) failed = true;
    record({
      section: "Migrations",
      check: "Tarot reference content retains version-qualified lineage",
      status: versionedReferenceSchemaOk ? "pass" : "fail",
      detail: versionedReferenceSchemaOk
        ? "card/deck and spread/version composite keys, lineage foreign keys, and non-null child versions are present"
        : "a composite reference key, lineage foreign key, or non-null child version is absent",
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
      select has_table_privilege(${APPLICATION_DATABASE_ROLE}, 'public.payment_webhook_events', 'select')
        as granted`;
    const webhookOk = webhook?.granted === false;
    if (!webhookOk) failed = true;
    record({
      section: "Row level security",
      check: "Webhook table withheld from the authenticated role",
      status: webhookOk ? "pass" : "fail",
      detail: webhookOk
        ? "payment_webhook_events is withheld from the application actor"
        : "payment_webhook_events is readable by the application actor",
    });

    const appOnlyRows = await sql<{ name: string; forced: boolean; browser_reachable: boolean }[]>`
      select required.name,
        exists (
          select 1 from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = required.name
            and c.relrowsecurity and c.relforcerowsecurity
        ) as forced,
        (
          has_table_privilege('authenticated', 'public.' || quote_ident(required.name), 'SELECT')
          or has_table_privilege('authenticated', 'public.' || quote_ident(required.name), 'INSERT')
          or has_table_privilege('authenticated', 'public.' || quote_ident(required.name), 'UPDATE')
          or has_table_privilege('authenticated', 'public.' || quote_ident(required.name), 'DELETE')
        ) as browser_reachable
      from unnest(${sql.array(APP_ONLY_TABLES as unknown as string[])}::text[]) as required(name)
      where to_regclass('public.' || quote_ident(required.name)) is not null`;
    const appOnlyStructureOk =
      appOnlyRows.length === APP_ONLY_TABLES.length &&
      appOnlyRows.every((row) => row.forced && !row.browser_reachable);
    const [jobsPolicy] = await sql<{ subject_bound_count: number }[]>`
      select count(*)::int as subject_bound_count from pg_policies
      where schemaname = 'public'
        and (tablename, policyname) in (
          ('interpretation_jobs', 'interpretation_jobs_subject'),
          ('report_jobs', 'report_jobs_subject')
        )
        and roles = array[${APPLICATION_DATABASE_ROLE}]::name[]
        and qual like '%request.jwt.claim.sub%'
        and with_check like '%request.jwt.claim.sub%'
    `;
    const appOnlyOk = appOnlyStructureOk && jobsPolicy?.subject_bound_count === 2;
    if (!appOnlyOk) failed = true;
    record({
      section: "Row level security",
      check: "App-only tables forced, browser-unreachable, and subject-bound for the actor",
      status: appOnlyOk ? "pass" : "fail",
      detail: appOnlyOk
        ? `${APP_ONLY_TABLES.length} app-only table(s) verified; both job-queue actor policies are subject-bound`
        : "an app-only table is missing forced RLS, is browser-reachable, or lacks the subject-bound actor policy",
    });

    const [browserRole] = await sql<{ private_access: boolean; actor_ready: boolean }[]>`
      select
        has_table_privilege('authenticated', 'public.users', 'select')
          or has_table_privilege('authenticated', 'public.reading_draws', 'update')
          or has_table_privilege('authenticated', 'public.entitlements', 'insert')
          as private_access,
        exists (
          select 1 from pg_roles where rolname = ${APPLICATION_DATABASE_ROLE}
            and not rolcanlogin and not rolsuper and not rolcreaterole
            and not rolcreatedb and not rolinherit and not rolbypassrls
        ) as actor_ready`;
    const roleBoundaryOk =
      browserRole?.private_access === false && browserRole.actor_ready === true;
    if (!roleBoundaryOk) failed = true;
    record({
      section: "Row level security",
      check: "Browser role separated from the server application actor",
      status: roleBoundaryOk ? "pass" : "fail",
      detail: roleBoundaryOk
        ? "authenticated has no private-table path; the server actor is non-login and non-privileged"
        : "the browser/server database-role boundary is not enforced",
    });

    let actorOk = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
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
      check: "Server application-role transaction available",
      status: actorOk ? "pass" : "fail",
      detail: actorOk
        ? `set local role ${APPLICATION_DATABASE_ROLE} with a verified subject succeeded`
        : `the connection role cannot assume ${APPLICATION_DATABASE_ROLE}`,
    });
    forcedRlsProved =
      tablesOk && rlsOk && policiesOk && webhookOk && appOnlyOk && roleBoundaryOk && actorOk;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }

  if (syncRemovalProved) completeStage("sync-trigger-absent");
  if (forcedRlsProved) completeStage("forced-rls");
  if (failed) process.exitCode = 1;
}

await main();
