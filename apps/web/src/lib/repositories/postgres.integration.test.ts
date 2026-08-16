import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DatabaseClient } from "@starguidance/database";

import {
  createSubject,
  deleteSubject,
  detectSubjectMode,
  type SubjectMode,
  type SyntheticSubject,
} from "@starguidance/database/test-support/synthetic-subjects";
import { clientFor, createPostgresRepositories } from "./postgres";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;

let sql: DatabaseClient | undefined;
let mode: SubjectMode = "plain";
let subject: SyntheticSubject | undefined;

const ids: Record<"user" | "profile" | "snapshot" | "order" | "entitlement" | "report", string> = {
  user: randomUUID(),
  profile: randomUUID(),
  snapshot: randomUUID(),
  order: randomUUID(),
  entitlement: randomUUID(),
  report: randomUUID(),
};

describeDatabase("Postgres paid-report fulfillment repository", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    sql = clientFor(databaseUrl);
    mode = await detectSubjectMode(sql);
    subject = await createSubject(sql, mode, "report-fulfillment");
    ids.user = subject.id;

    await sql.begin(async (tx) => {
      await tx`insert into users (id, email) values (${ids.user}, ${subject?.email ?? ""})`;
      await tx`insert into birth_profiles (id, user_id, encrypted_payload) values
        (${ids.profile}, ${ids.user}, '2.profile.encrypted')`;
      await tx`insert into profile_snapshots
        (id, user_id, profile_id, version, completeness, derived_payload, calculation_versions) values
        (${ids.snapshot}, ${ids.user}, ${ids.profile}, 1, 'core',
         ${tx.json({ snapshot: { id: ids.snapshot } })}, ${tx.json({ numerology: "v1" })})`;
      await tx`update birth_profiles set active_snapshot_id = ${ids.snapshot}
        where id = ${ids.profile}`;
      await tx`insert into orders
        (id, user_id, product_id, profile_snapshot_id, provider, provider_session_id,
         idempotency_key, encrypted_report_source, status) values
        (${ids.order}, ${ids.user}, 'profile-report-v1', ${ids.snapshot}, 'stripe',
         ${`session-${ids.order}`}, ${`key-${ids.order}`}, '2.minimized-derived-source',
         'pending')`;
    });
  });

  afterAll(async () => {
    if (!sql || !databaseUrl) return;
    await sql`delete from users where id = ${ids.user}`.catch(() => undefined);
    if (subject) await deleteSubject(sql, mode, subject).catch(() => undefined);
    await sql.end({ timeout: 5 }).catch(() => undefined);
    const pools = (
      globalThis as typeof globalThis & {
        __starGuidancePostgresClients?: Map<string, DatabaseClient>;
      }
    ).__starGuidancePostgresClients;
    pools?.delete(databaseUrl);
  });

  it("atomically fulfills a paid order after profile deletion and replays without duplicates", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const repositories = createPostgresRepositories({ databaseUrl, serviceRole: true });
    const encryptedSource = "2.minimized-derived-source";

    // Checkout may be open while the user deletes private profile data. The
    // order and its minimized source survive, while migration 0012 nulls the
    // deleted snapshot pointer before Stripe's paid webhook arrives.
    await sql`delete from birth_profiles where id = ${ids.profile}`;
    const [pending] = await sql`
      select status, profile_snapshot_id, encrypted_report_source
      from orders where id = ${ids.order}`;
    expect(pending).toMatchObject({
      status: "pending",
      profile_snapshot_id: null,
      encrypted_report_source: encryptedSource,
    });

    const createdAt = "2026-08-10T00:00:00.000Z";
    const fulfillment = {
      orderId: ids.order,
      userId: ids.user,
      snapshotId: null,
      reportId: ids.report,
      entitlementId: ids.entitlement,
      createdAt,
    };
    const report = await repositories.reportFulfillment.enqueuePaid(fulfillment);
    const replay = await repositories.reportFulfillment.enqueuePaid({
      ...fulfillment,
      reportId: randomUUID(),
      entitlementId: randomUUID(),
    });

    expect(report).toMatchObject({
      id: ids.report,
      userId: ids.user,
      snapshotId: null,
      orderId: ids.order,
      provider: "stripe",
      status: "pending",
      sections: [],
    });
    expect(replay.id).toBe(ids.report);

    const [state] = await sql<
      {
        order_status: string;
        order_source: string | null;
        entitlement_count: number;
        report_count: number;
        job_count: number;
        job_source: string | null;
      }[]
    >`
      select
        (select status from orders where id = ${ids.order}) as order_status,
        (select encrypted_report_source from orders where id = ${ids.order}) as order_source,
        (select count(*)::int from entitlements where order_id = ${ids.order}) as entitlement_count,
        (select count(*)::int from reports r join entitlements e on e.id = r.entitlement_id
          where e.order_id = ${ids.order}) as report_count,
        (select count(*)::int from report_jobs where report_id = ${ids.report}) as job_count,
        (select encrypted_source from report_jobs where report_id = ${ids.report}) as job_source
    `;
    expect(state).toEqual({
      order_status: "paid",
      order_source: null,
      entitlement_count: 1,
      report_count: 1,
      job_count: 1,
      job_source: encryptedSource,
    });
  });
});
