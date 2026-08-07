import { encryptSensitive, decryptSensitive } from "../src/encryption";
import { createDatabaseClient, type DatabaseClient } from "../src/postgres-client";

const IDS = {
  user: "00000000-0000-4000-8000-000000000101",
  profile: "00000000-0000-4000-8000-000000000102",
  snapshot: "00000000-0000-4000-8000-000000000103",
  reading: "00000000-0000-4000-8000-000000000104",
  order: "00000000-0000-4000-8000-000000000105",
  entitlement: "00000000-0000-4000-8000-000000000106",
  report: "00000000-0000-4000-8000-000000000107",
} as const;

const EMAIL = "sg-verify-restore@starguidance.test";
const TEST_KEY = Buffer.alloc(32, 19).toString("base64");

type Action = "seed" | "verify" | "cleanup";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function action(): Action {
  if (
    process.env.APP_ENV !== "test" ||
    process.env.RESTORE_FIXTURE_CONFIRM !== "SYNTHETIC_DISPOSABLE_DATABASE"
  )
    throw new Error("Restore fixtures are restricted to an explicitly confirmed test database");
  const value = process.env.RESTORE_FIXTURE_ACTION;
  if (value !== "seed" && value !== "verify" && value !== "cleanup")
    throw new Error("RESTORE_FIXTURE_ACTION must be seed, verify, or cleanup");
  return value;
}

async function authUsersPresent(sql: DatabaseClient): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`
    select to_regclass('auth.users') is not null as present`;
  return row?.present === true;
}

async function cleanup(sql: DatabaseClient): Promise<void> {
  if (await authUsersPresent(sql)) await sql`delete from auth.users where id = ${IDS.user}`;
  await sql`delete from users where id = ${IDS.user}`;
}

async function seed(sql: DatabaseClient): Promise<void> {
  await cleanup(sql);
  const [deck] = await sql`select version from decks order by created_at limit 1`;
  const [spread] = await sql`select id, version from spreads order by id limit 1`;
  if (!deck || !spread) throw new Error("Reference seed data is required before restore fixture");

  // Contexts match the application's encryptionAadContext convention
  // (apps/web/src/lib/persistence.ts) so the restored envelopes verify the
  // same binding production rows carry.
  const profileEnvelope = encryptSensitive(
    "synthetic restore profile",
    TEST_KEY,
    `profile-input:${IDS.user}`,
  );
  const calculationEnvelope = encryptSensitive(
    "synthetic restore calculation",
    TEST_KEY,
    `profile-calculations:${IDS.user}`,
  );
  const questionEnvelope = encryptSensitive(
    "synthetic restore question",
    TEST_KEY,
    `reading-question:${IDS.user}`,
  );

  await sql.begin(async (tx) => {
    const [auth] = await tx<{ present: boolean }[]>`
      select to_regclass('auth.users') is not null as present`;
    if (auth?.present) await tx`insert into auth.users (id, email) values (${IDS.user}, ${EMAIL})`;
    await tx`insert into users (id, email) values (${IDS.user}, ${EMAIL})`;
    await tx`insert into birth_profiles (id, user_id, encrypted_payload)
      values (${IDS.profile}, ${IDS.user}, ${profileEnvelope})`;
    await tx`insert into profile_snapshots (
      id, user_id, profile_id, version, completeness, derived_payload, calculation_versions
    ) values (
      ${IDS.snapshot}, ${IDS.user}, ${IDS.profile}, 1, 'core',
      ${tx.json({ snapshot: { id: IDS.snapshot, version: 1 } })},
      ${tx.json({ numerology: "restore-v1" })}
    )`;
    await tx`update birth_profiles set active_snapshot_id = ${IDS.snapshot}
      where id = ${IDS.profile}`;
    await tx`insert into profile_components (user_id, snapshot_id, system, status, payload) values
      (${IDS.user}, ${IDS.snapshot}, 'private-profile-input', 'implemented',
        ${tx.json({ envelope: profileEnvelope })}),
      (${IDS.user}, ${IDS.snapshot}, 'private-calculations', 'implemented',
        ${tx.json({ envelope: calculationEnvelope })})`;
    await tx`insert into reading_sessions (
      id, user_id, profile_snapshot_id, spread_id, spread_version, idempotency_key,
      encrypted_question,
      reading_lens, safety_classification, state
    ) values (
      ${IDS.reading}, ${IDS.user}, ${IDS.snapshot}, ${String(spread.id)},
      ${String(spread.version)}, 'restore-reading-idempotency', ${questionEnvelope},
      ${tx.json({ version: "restore-v1" })},
      'standard', 'ready'
    )`;
    await tx`insert into reading_draws (
      user_id, reading_id, deck_version, shuffle_version, assignments, locked_at
    ) values (
      ${IDS.user}, ${IDS.reading}, ${String(deck.version)}, 'secure-fisher-yates-v1',
      ${tx.json([
        { positionId: "focus", cardId: "major-00", orientation: "upright", order: 0 },
      ])}, now()
    )`;
    await tx`insert into orders (
      id, user_id, product_id, profile_snapshot_id, provider, provider_session_id,
      idempotency_key, status
    ) values (
      ${IDS.order}, ${IDS.user}, 'profile-report-v1', ${IDS.snapshot}, 'local',
      'restore-session', 'restore-idempotency', 'paid'
    )`;
    await tx`insert into entitlements (
      id, user_id, product_id, profile_snapshot_id, order_id, status
    ) values (
      ${IDS.entitlement}, ${IDS.user}, 'profile-report-v1', ${IDS.snapshot}, ${IDS.order}, 'active'
    )`;
    await tx`insert into reports (
      id, user_id, entitlement_id, profile_snapshot_id, status, template_version, payload
    ) values (
      ${IDS.report}, ${IDS.user}, ${IDS.entitlement}, ${IDS.snapshot}, 'ready',
      'profile-report-v1', ${tx.json({ synthetic: true })}
    )`;
    await tx`insert into report_sections (user_id, report_id, section_key, payload)
      values (${IDS.user}, ${IDS.report}, 'overview', ${tx.json({ synthetic: true })})`;
  });
}

async function verify(sql: DatabaseClient): Promise<void> {
  const [lineage] = await sql<
    {
      active_snapshot_id: string;
      reading_snapshot_id: string;
      order_snapshot_id: string;
      report_snapshot_id: string;
      entitlement_status: string;
      profile_envelope: string;
      question_envelope: string;
      section_count: number;
    }[]
  >`
    select bp.active_snapshot_id, rs.profile_snapshot_id as reading_snapshot_id,
      o.profile_snapshot_id as order_snapshot_id, r.profile_snapshot_id as report_snapshot_id,
      e.status as entitlement_status, bp.encrypted_payload as profile_envelope,
      rs.encrypted_question as question_envelope,
      (select count(*)::integer from report_sections where report_id = r.id) as section_count
    from users u
    join birth_profiles bp on bp.user_id = u.id
    join reading_sessions rs on rs.user_id = u.id
    join orders o on o.user_id = u.id
    join entitlements e on e.order_id = o.id
    join reports r on r.entitlement_id = e.id
    where u.id = ${IDS.user} and bp.id = ${IDS.profile} and rs.id = ${IDS.reading}
      and o.id = ${IDS.order} and r.id = ${IDS.report}`;
  if (!lineage) throw new Error("The restored private-data lineage is incomplete");
  for (const value of [
    lineage.active_snapshot_id,
    lineage.reading_snapshot_id,
    lineage.order_snapshot_id,
    lineage.report_snapshot_id,
  ])
    if (String(value) !== IDS.snapshot)
      throw new Error("The restored private-data lineage references the wrong snapshot");
  if (lineage.entitlement_status !== "active" || lineage.section_count !== 1)
    throw new Error("The restored entitlement or report structure is incomplete");
  if (
    decryptSensitive(lineage.profile_envelope, TEST_KEY, `profile-input:${IDS.user}`) !==
      "synthetic restore profile" ||
    decryptSensitive(lineage.question_envelope, TEST_KEY, `reading-question:${IDS.user}`) !==
      "synthetic restore question"
  )
    throw new Error("The restored encrypted payloads failed authentication");
}

async function main(): Promise<void> {
  const operation = action();
  const sql = createDatabaseClient(required("DATABASE_URL"));
  try {
    if (operation === "seed") await seed(sql);
    else if (operation === "verify") await verify(sql);
    else await cleanup(sql);
    process.stdout.write(`Synthetic restore fixture ${operation} passed.\n`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

await main();
