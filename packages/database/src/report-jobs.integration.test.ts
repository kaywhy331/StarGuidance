import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimReportJobs,
  completeReportJob,
  failReportJob,
  getReportQueueStats,
  markReportGenerationFailed,
  reenqueueReportJob,
  writeReportResult,
  type ClaimedReportJob,
} from "./report-jobs";
import { createDatabaseClient, type DatabaseTransaction } from "./postgres-client";
import { actorTransaction } from "./system-transaction";
import {
  createSubject,
  deleteSubject,
  detectSubjectMode,
  type SubjectMode,
  type SyntheticSubject,
} from "../tests/support/synthetic-subjects";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const sql = databaseUrl ? createDatabaseClient(databaseUrl) : undefined;

let mode: SubjectMode = "plain";
let subject: SyntheticSubject | undefined;
let otherSubject: SyntheticSubject | undefined;
let userId: string = randomUUID();
let otherUserId: string = randomUUID();
let profileId: string = randomUUID();
let snapshotId: string = randomUUID();

async function asWorker<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return sql.begin((tx) => work(tx as DatabaseTransaction)) as Promise<T>;
}

async function asUser<T>(
  actorId: string,
  work: (tx: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return actorTransaction(sql, actorId, work);
}

async function createPurchase(maxAttempts = 5): Promise<{
  orderId: string;
  entitlementId: string;
  reportId: string;
}> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  const orderId = randomUUID();
  const entitlementId = randomUUID();
  const reportId = randomUUID();
  await sql.begin(async (tx) => {
    await tx`insert into orders
      (id, user_id, product_id, profile_snapshot_id, provider, provider_session_id,
       idempotency_key, status) values
      (${orderId}, ${userId}, 'profile-report-v1', ${snapshotId}, 'stripe',
       ${`session-${orderId}`}, ${`key-${orderId}`}, 'paid')`;
    await tx`insert into entitlements
      (id, user_id, product_id, profile_snapshot_id, order_id, status) values
      (${entitlementId}, ${userId}, 'profile-report-v1', ${snapshotId}, ${orderId}, 'active')`;
    await tx`insert into reports
      (id, user_id, entitlement_id, profile_snapshot_id, status, template_version, payload) values
      (${reportId}, ${userId}, ${entitlementId}, ${snapshotId}, 'pending',
       'profile-report-v2', ${tx.json({ sectionCount: 0 })})`;
    await tx`insert into report_jobs
      (user_id, report_id, encrypted_source, max_attempts) values
      (${userId}, ${reportId}, ${`2.encrypted-source-${reportId}`}, ${maxAttempts})`;
  });
  return { orderId, entitlementId, reportId };
}

async function claimReport(reportId: string): Promise<ClaimedReportJob> {
  const [job] = await asWorker((tx) => claimReportJobs(tx, 1, { reportId }));
  if (!job) throw new Error(`Expected a claimable report job for ${reportId}`);
  return job;
}

describeDatabase("Postgres-backed report fulfillment jobs", () => {
  beforeAll(async () => {
    if (!sql) return;
    mode = await detectSubjectMode(sql);
    subject = await createSubject(sql, mode, "report-jobs");
    otherSubject = await createSubject(sql, mode, "report-jobs-other");
    userId = subject.id;
    otherUserId = otherSubject.id;
    profileId = randomUUID();
    snapshotId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`insert into users (id, email) values
        (${userId}, ${subject?.email ?? ""}), (${otherUserId}, ${otherSubject?.email ?? ""})`;
      await tx`insert into birth_profiles (id, user_id, encrypted_payload) values
        (${profileId}, ${userId}, '2.profile.encrypted')`;
      await tx`insert into profile_snapshots
        (id, user_id, profile_id, version, completeness, derived_payload, calculation_versions) values
        (${snapshotId}, ${userId}, ${profileId}, 1, 'core',
         ${tx.json({ snapshot: { id: snapshotId } })}, ${tx.json({ numerology: "v1" })})`;
      await tx`update birth_profiles set active_snapshot_id = ${snapshotId} where id = ${profileId}`;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from users where id in (${userId}, ${otherUserId})`;
    for (const candidate of [subject, otherSubject])
      if (candidate) await deleteSubject(sql, mode, candidate).catch(() => undefined);
    await sql.end();
  });

  it("claims a pending report once and returns its encrypted source only to the worker", async () => {
    const purchase = await createPurchase();
    const job = await claimReport(purchase.reportId);

    expect(job.encryptedSource).toContain(purchase.reportId);
    const second = await asWorker((tx) => claimReportJobs(tx, 1, { reportId: purchase.reportId }));
    expect(second.some(({ reportId }) => reportId === purchase.reportId)).toBe(false);
    await completeReportJob(sql!, job.id);
  });

  it("backs off transient failures and marks terminal work separately", async () => {
    const retryable = await createPurchase();
    const retryableJob = await claimReport(retryable.reportId);
    expect(await failReportJob(sql!, retryableJob, "fixed_failure_class")).toEqual({
      terminal: false,
    });
    const [pending] = await sql!`
      select status, last_error from report_jobs where id = ${retryableJob.id}`;
    expect(pending).toMatchObject({ status: "pending", last_error: "fixed_failure_class" });

    const terminal = await createPurchase(1);
    const terminalJob = await claimReport(terminal.reportId);
    expect(await failReportJob(sql!, terminalJob, "fixed_terminal_class")).toEqual({
      terminal: true,
    });
    await asUser(userId, (tx) =>
      markReportGenerationFailed(tx, { userId, reportId: terminal.reportId }),
    );
    const [failed] = await sql!`select status from reports where id = ${terminal.reportId}`;
    expect(failed?.status).toBe("failed");
  });

  it("writes all sections and clears the temporary source on completion", async () => {
    const purchase = await createPurchase();
    const job = await claimReport(purchase.reportId);
    await asUser(userId, (tx) =>
      writeReportResult(tx, {
        userId,
        reportId: purchase.reportId,
        sections: [
          { key: "overview", title: "Overview", body: "Derived report content." },
          { key: "astrology", title: "Western astrology", body: "Unavailable.", unavailable: true },
        ],
      }),
    );
    await completeReportJob(sql!, job.id);

    const [report] =
      await sql!`select status, payload from reports where id = ${purchase.reportId}`;
    const [storedJob] = await sql!`
      select status, encrypted_source from report_jobs where id = ${job.id}`;
    const [sectionCount] = await sql!`
      select count(*)::int as count from report_sections where report_id = ${purchase.reportId}`;
    expect(report).toMatchObject({ status: "ready", payload: { sectionCount: 2 } });
    expect(storedJob).toMatchObject({ status: "completed", encrypted_source: null });
    expect(sectionCount?.count).toBe(2);
  });

  it("subject-binds user retries while queue stats remain available to the worker", async () => {
    const purchase = await createPurchase(1);
    const job = await claimReport(purchase.reportId);
    await failReportJob(sql!, job, "fixed_terminal_class");

    expect(await asUser(otherUserId, (tx) => reenqueueReportJob(tx, purchase.reportId))).toBe(
      false,
    );
    expect(await asUser(userId, (tx) => reenqueueReportJob(tx, purchase.reportId))).toBe(true);
    const stats = await getReportQueueStats(sql!);
    expect(stats.depth).toBeGreaterThanOrEqual(1);
  });

  it("retains paid commerce and a pending source when the private profile is deleted", async () => {
    const purchase = await createPurchase();

    await asUser(userId, (tx) => tx`delete from birth_profiles where id = ${profileId}`);

    const [retained] = await sql!`
      select
        (select profile_snapshot_id from orders where id = ${purchase.orderId}) as order_snapshot,
        (select profile_snapshot_id from entitlements where id = ${purchase.entitlementId}) as entitlement_snapshot,
        (select profile_snapshot_id from reports where id = ${purchase.reportId}) as report_snapshot,
        (select encrypted_source from report_jobs where report_id = ${purchase.reportId}) as encrypted_source
    `;
    expect(retained).toMatchObject({
      order_snapshot: null,
      entitlement_snapshot: null,
      report_snapshot: null,
    });
    expect(String(retained?.encrypted_source)).toContain(purchase.reportId);
  });
});
