import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseClient, type DatabaseTransaction } from "./postgres-client";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;
const ids = {
  userA: randomUUID(),
  userB: randomUUID(),
  profileA: randomUUID(),
  profileB: randomUUID(),
  snapshotA1: randomUUID(),
  snapshotA2: randomUUID(),
  snapshotB: randomUUID(),
  readingA: randomUUID(),
  readingB: randomUUID(),
  orderA: randomUUID(),
  orderB: randomUUID(),
  entitlementA: randomUUID(),
  entitlementB: randomUUID(),
  reportA: randomUUID(),
  reportB: randomUUID(),
};

async function asUser<T>(userId: string, work: (tx: DatabaseTransaction) => Promise<T>) {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
    return work(tx as DatabaseTransaction);
  });
}

describeDatabase("Supabase/Postgres repository isolation", () => {
  beforeAll(async () => {
    if (!sql) return;
    const [deck] = await sql`select version from decks order by created_at limit 1`;
    const [spread] = await sql`select id, version from spreads order by id limit 1`;
    if (!deck || !spread) throw new Error("Reference seed data is required");
    const now = new Date().toISOString();
    await sql.begin(async (tx) => {
      await tx`insert into users (id, email) values
        (${ids.userA}, ${`rls-a-${ids.userA}@example.test`}),
        (${ids.userB}, ${`rls-b-${ids.userB}@example.test`})`;
      await tx`insert into user_settings (user_id, display_name) values
        (${ids.userA}, 'A'), (${ids.userB}, 'B')`;
      await tx`insert into consents (user_id, policy, policy_version, accepted_at) values
        (${ids.userA}, 'privacy-reflective', 'v1', ${now}),
        (${ids.userB}, 'privacy-reflective', 'v1', ${now})`;
      await tx`insert into birth_profiles (id, user_id, encrypted_payload) values
        (${ids.profileA}, ${ids.userA}, '1.profile-a.encrypted'),
        (${ids.profileB}, ${ids.userB}, '1.profile-b.encrypted')`;
      await tx`insert into profile_snapshots
        (id, user_id, profile_id, version, completeness, derived_payload, calculation_versions) values
        (${ids.snapshotA1}, ${ids.userA}, ${ids.profileA}, 1, 'core',
          ${tx.json({ snapshot: { id: ids.snapshotA1 }, metadata: {} })}, ${tx.json({ numerology: "v1" })}),
        (${ids.snapshotA2}, ${ids.userA}, ${ids.profileA}, 2, 'complete',
          ${tx.json({ snapshot: { id: ids.snapshotA2 }, metadata: {} })}, ${tx.json({ numerology: "v1" })}),
        (${ids.snapshotB}, ${ids.userB}, ${ids.profileB}, 1, 'core',
          ${tx.json({ snapshot: { id: ids.snapshotB }, metadata: {} })}, ${tx.json({ numerology: "v1" })})`;
      await tx`update birth_profiles set active_snapshot_id = case
        when id = ${ids.profileA} then ${ids.snapshotA2}::uuid else ${ids.snapshotB}::uuid end
        where id in (${ids.profileA}, ${ids.profileB})`;
      await tx`insert into profile_components (user_id, snapshot_id, system, status, payload) values
        (${ids.userA}, ${ids.snapshotA1}, 'private-calculations', 'implemented', ${tx.json({ envelope: "1.calc-a.encrypted" })}),
        (${ids.userB}, ${ids.snapshotB}, 'private-calculations', 'implemented', ${tx.json({ envelope: "1.calc-b.encrypted" })})`;
      await tx`insert into profile_traits (user_id, snapshot_id, domain, statement, provenance) values
        (${ids.userA}, ${ids.snapshotA1}, 'decisionStyle', 'synthetic-a', ${tx.json({ source: "test" })}),
        (${ids.userB}, ${ids.snapshotB}, 'decisionStyle', 'synthetic-b', ${tx.json({ source: "test" })})`;
      await tx`insert into reading_sessions
        (id, user_id, profile_snapshot_id, spread_id, spread_version, encrypted_question,
         reading_lens, safety_classification, state) values
        (${ids.readingA}, ${ids.userA}, ${ids.snapshotA1}, ${String(spread.id)}, ${String(spread.version)},
          '1.question-a.encrypted', ${tx.json({ version: "v1", traitIndexes: [0] })}, 'standard', 'failed'),
        (${ids.readingB}, ${ids.userB}, ${ids.snapshotB}, ${String(spread.id)}, ${String(spread.version)},
          '1.question-b.encrypted', ${tx.json({ version: "v1", traitIndexes: [0] })}, 'standard', 'ready')`;
      await tx`insert into reading_draws
        (user_id, reading_id, deck_version, shuffle_version, assignments, locked_at) values
        (${ids.userA}, ${ids.readingA}, ${String(deck.version)}, 'secure-fisher-yates-v1',
          ${tx.json([{ positionId: "focus", cardId: "major-00", orientation: "upright", order: 0 }])}, ${now}),
        (${ids.userB}, ${ids.readingB}, ${String(deck.version)}, 'secure-fisher-yates-v1',
          ${tx.json([{ positionId: "focus", cardId: "major-01", orientation: "reversed", order: 0 }])}, ${now})`;
      await tx`insert into reading_outputs
        (user_id, reading_id, provider_id, prompt_version, content_version, schema_version, payload) values
        (${ids.userB}, ${ids.readingB}, 'test', 'v1', 'v1', 'v1', ${tx.json({ title: "synthetic-b" })})`;
      await tx`insert into follow_up_questions (user_id, reading_id, encrypted_question, output) values
        (${ids.userA}, ${ids.readingA}, '1.follow-a.encrypted', ${tx.json({ title: "synthetic-a" })}),
        (${ids.userB}, ${ids.readingB}, '1.follow-b.encrypted', ${tx.json({ title: "synthetic-b" })})`;
      await tx`insert into reading_feedback (user_id, reading_id, resonance) values
        (${ids.userA}, ${ids.readingA}, 4), (${ids.userB}, ${ids.readingB}, 3)`;
      await tx`insert into orders
        (id, user_id, product_id, profile_snapshot_id, provider, provider_session_id, idempotency_key, status) values
        (${ids.orderA}, ${ids.userA}, 'profile-report-v1', ${ids.snapshotA1}, 'stripe', ${`session-${ids.orderA}`}, 'key-a', 'paid'),
        (${ids.orderB}, ${ids.userB}, 'profile-report-v1', ${ids.snapshotB}, 'stripe', ${`session-${ids.orderB}`}, 'key-b', 'paid')`;
      await tx`insert into entitlements
        (id, user_id, product_id, profile_snapshot_id, order_id, status) values
        (${ids.entitlementA}, ${ids.userA}, 'profile-report-v1', ${ids.snapshotA1}, ${ids.orderA}, 'active'),
        (${ids.entitlementB}, ${ids.userB}, 'profile-report-v1', ${ids.snapshotB}, ${ids.orderB}, 'active')`;
      await tx`insert into reports
        (id, user_id, entitlement_id, profile_snapshot_id, status, template_version) values
        (${ids.reportA}, ${ids.userA}, ${ids.entitlementA}, ${ids.snapshotA1}, 'ready', 'v1'),
        (${ids.reportB}, ${ids.userB}, ${ids.entitlementB}, ${ids.snapshotB}, 'ready', 'v1')`;
      await tx`insert into report_sections (user_id, report_id, section_key, payload) values
        (${ids.userA}, ${ids.reportA}, 'overview', ${tx.json({ body: "synthetic-a" })}),
        (${ids.userB}, ${ids.reportB}, 'overview', ${tx.json({ body: "synthetic-b" })})`;
      await tx`insert into audit_events (user_id, action, target_type, target_id, metadata) values
        (${ids.userA}, 'test.created', 'test', ${ids.readingA}, ${tx.json({})}),
        (${ids.userB}, 'test.created', 'test', ${ids.readingB}, ${tx.json({})})`;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from users where id in (${ids.userA}, ${ids.userB})`;
    await sql.end();
  });

  it("prevents either authenticated user from selecting every other user's private record", async () => {
    const tables = [
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
    for (const [viewer, other] of [
      [ids.userA, ids.userB],
      [ids.userB, ids.userA],
    ] as const) {
      await asUser(viewer, async (tx) => {
        const [otherUser] =
          await tx`select count(*)::integer as count from users where id = ${other}`;
        expect(otherUser?.count).toBe(0);
        for (const table of tables) {
          const [row] = await tx.unsafe<{ count: number }[]>(
            `select count(*)::integer as count from public.${table} where user_id = $1`,
            [other],
          );
          expect(row?.count, table).toBe(0);
        }
      });
    }
  });

  it("blocks cross-user writes even when IDs are known", async () => {
    await expect(
      asUser(ids.userA, async (tx) => {
        await tx`insert into consents (user_id, policy, policy_version, accepted_at)
        values (${ids.userB}, 'privacy-reflective', 'attack', now())`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
    await asUser(ids.userA, async (tx) => {
      const rows = await tx`update reading_sessions set state = 'ready'
        where id = ${ids.readingB} returning id`;
      expect(rows).toHaveLength(0);
    });
  });

  it("recovers a failed reading with the identical locked draw", async () => {
    await asUser(ids.userA, async (tx) => {
      const [before] = await tx`select d.assignments, s.encrypted_question from reading_sessions s
        join reading_draws d on d.reading_id = s.id where s.id = ${ids.readingA}`;
      await tx`update reading_sessions set state = 'ready' where id = ${ids.readingA}`;
      await tx`insert into reading_outputs
        (user_id, reading_id, provider_id, prompt_version, content_version, schema_version, payload)
        values (${ids.userA}, ${ids.readingA}, 'fallback', 'v1', 'v1', 'v1', ${tx.json({ title: "retry" })})`;
      const [after] = await tx`select d.assignments, s.encrypted_question from reading_sessions s
        join reading_draws d on d.reading_id = s.id where s.id = ${ids.readingA}`;
      expect(after?.assignments).toEqual(before?.assignments);
      expect(after?.encrypted_question).toBe(before?.encrypted_question);
    });
  });

  it("preserves profile history and historical reading snapshot references", async () => {
    await asUser(ids.userA, async (tx) => {
      const versions = await tx`select version from profile_snapshots
        where profile_id = ${ids.profileA} order by version`;
      expect(versions.map(({ version }) => version)).toEqual([1, 2]);
      const [active] =
        await tx`select active_snapshot_id from birth_profiles where id = ${ids.profileA}`;
      const [historical] =
        await tx`select profile_snapshot_id from reading_sessions where id = ${ids.readingA}`;
      expect(String(active?.active_snapshot_id)).toBe(ids.snapshotA2);
      expect(String(historical?.profile_snapshot_id)).toBe(ids.snapshotA1);
    });
  });

  it("builds an RLS-scoped export and durably deletes only the requesting account", async () => {
    await asUser(ids.userA, async (tx) => {
      const [exportRow] = await tx`select jsonb_build_object(
        'profiles', (select count(*) from profile_snapshots),
        'readings', (select count(*) from reading_sessions),
        'reports', (select count(*) from reports),
        'orders', (select count(*) from orders)) as payload`;
      expect(exportRow?.payload).toEqual({ profiles: 2, readings: 1, reports: 1, orders: 1 });
      await tx`delete from users where id = ${ids.userA}`;
    });
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    for (const table of [
      "users",
      "birth_profiles",
      "profile_snapshots",
      "reading_sessions",
      "reading_draws",
      "follow_up_questions",
      "reports",
      "orders",
    ]) {
      const column = table === "users" ? "id" : "user_id";
      const [row] = await sql.unsafe<{ count: number }[]>(
        `select count(*)::integer as count from public.${table} where ${column} = $1`,
        [ids.userA],
      );
      expect(row?.count, table).toBe(0);
    }
    const [other] = await sql`select count(*)::integer as count from users where id = ${ids.userB}`;
    expect(other?.count).toBe(1);
  });
});
