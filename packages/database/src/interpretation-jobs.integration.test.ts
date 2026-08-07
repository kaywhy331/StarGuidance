import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimInterpretationJobs,
  completeInterpretationJob,
  failInterpretationJob,
  insertInterpretationJob,
  markReadingGenerationFailed,
  reenqueueInterpretationJob,
  writeInterpretationResult,
  type ClaimedInterpretationJob,
} from "./interpretation-jobs";
import { createDatabaseClient, type DatabaseTransaction } from "./postgres-client";
import { actorTransaction, systemTransaction } from "./system-transaction";
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
let userId: string = randomUUID();
let snapshotId: string = randomUUID();
let spread: { id: string; version: string } | undefined;

async function asApp<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return systemTransaction(sql, work);
}

/** A fresh reading_sessions row per test, so dedup/claim state never leaks across tests. */
async function createReading(): Promise<string> {
  if (!sql || !spread) throw new Error("DATABASE_INTEGRATION_URL is required");
  const readingId = randomUUID();
  await sql`
    insert into reading_sessions
      (id, user_id, profile_snapshot_id, spread_id, spread_version, idempotency_key,
       encrypted_question, reading_lens, safety_classification, state) values
      (${readingId}, ${userId}, ${snapshotId}, ${spread.id}, ${spread.version},
       ${`reading-${readingId}`}, '1.question.encrypted',
       ${sql.json({ version: "v1", traitIndexes: [] })}, 'standard', 'pending')
  `;
  return readingId;
}

async function claim(limit = 1): Promise<ClaimedInterpretationJob[]> {
  return asApp((tx) => claimInterpretationJobs(tx, limit));
}

/**
 * Claims a large batch and picks out the one job this test cares about,
 * rather than assuming a claim returns exactly this test's job — every test
 * shares one interpretation_jobs table, so an earlier test's job can still be
 * sitting there pending/expired and would otherwise win the claim-query's
 * `order by available_at` ahead of a job created moments ago.
 */
async function claimReading(readingId: string): Promise<ClaimedInterpretationJob> {
  const claimed = await claim(50);
  const job = claimed.find((candidate) => candidate.readingId === readingId);
  if (!job) throw new Error(`Expected a claimable job for reading ${readingId}`);
  return job;
}

describeDatabase("Postgres-backed interpretation jobs", () => {
  beforeAll(async () => {
    if (!sql) return;
    const [seededSpread] = await sql`select id, version from spreads order by id limit 1`;
    if (!seededSpread) throw new Error("Reference seed data is required");
    spread = { id: String(seededSpread.id), version: String(seededSpread.version) };

    mode = await detectSubjectMode(sql);
    subject = await createSubject(sql, mode, "interp-jobs");
    userId = subject.id;
    const profileId = randomUUID();
    snapshotId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`insert into users (id, email) values (${userId}, ${subject?.email ?? ""})`;
      await tx`insert into birth_profiles (id, user_id, encrypted_payload) values
        (${profileId}, ${userId}, '1.profile.encrypted')`;
      await tx`insert into profile_snapshots
        (id, user_id, profile_id, version, completeness, derived_payload, calculation_versions) values
        (${snapshotId}, ${userId}, ${profileId}, 1, 'core',
          ${tx.json({ snapshot: { id: snapshotId } })}, ${tx.json({ numerology: "v1" })})`;
      await tx`update birth_profiles set active_snapshot_id = ${snapshotId} where id = ${profileId}`;
    });
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from users where id = ${userId}`;
    if (subject) await deleteSubject(sql, mode, subject).catch(() => undefined);
    await sql.end();
  });

  it("enforces one job per reading via the dedup unique index", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    await expect(
      asApp((tx) => insertInterpretationJob(tx, { userId, readingId })),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("claims a pending job exactly once and leaves it unclaimable again immediately", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const claimed = await claimReading(readingId);
    expect(claimed.attemptCount).toBe(1);
    const secondAttempt = await claim(50);
    expect(secondAttempt.find((job) => job.readingId === readingId)).toBeUndefined();
  });

  it("serializes concurrent claims so exactly one caller gets a given job (FOR UPDATE SKIP LOCKED)", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(1)));
    const winners = results.filter((jobs) => jobs.some((job) => job.readingId === readingId));
    expect(winners).toHaveLength(1);
  });

  it("reclaims a job whose lease expired without a completion", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    await claimReading(readingId);
    await asApp(
      (tx) => tx`
      update interpretation_jobs set lock_expires_at = now() - interval '1 second'
      where reading_id = ${readingId}
    `,
    );
    const reclaimed = await claimReading(readingId);
    expect(reclaimed.attemptCount).toBe(2);
  });

  it("returns a failed job to pending with capped exponential backoff until max_attempts, then terminates it", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    let job = await claimReading(readingId);
    expect(job.maxAttempts).toBe(5);
    for (let attempt = job.attemptCount; attempt < job.maxAttempts; attempt += 1) {
      const before = Date.now();
      const outcome = await asApp((tx) => failInterpretationJob(tx, job, `attempt-${attempt}`));
      expect(outcome.terminal).toBe(false);
      const [row] = await asApp(
        (tx) =>
          tx`select status, available_at, last_error from interpretation_jobs where id = ${job.id}`,
      );
      expect(row?.status).toBe("pending");
      expect(row?.last_error).toBe(`attempt-${attempt}`);
      // Capped exponential backoff: 2^attempt seconds, capped at 300s.
      const expectedBackoffMs = Math.min(2 ** attempt, 300) * 1000;
      const actualDelayMs = new Date(row!.available_at as string).getTime() - before;
      expect(actualDelayMs).toBeGreaterThanOrEqual(expectedBackoffMs - 500);
      expect(actualDelayMs).toBeLessThanOrEqual(expectedBackoffMs + 2000);
      // Test-only: skip the wait so the loop can exercise the next attempt
      // immediately rather than sleeping out a real (possibly 300s) backoff.
      await asApp(
        (tx) => tx`update interpretation_jobs set available_at = now() where id = ${job.id}`,
      );
      job = await claimReading(readingId);
    }
    const finalOutcome = await asApp((tx) => failInterpretationJob(tx, job, "final-failure"));
    expect(finalOutcome.terminal).toBe(true);
    const [row] = await asApp(
      (tx) => tx`select status from interpretation_jobs where id = ${job.id}`,
    );
    expect(row?.status).toBe("failed");
    expect((await claim(50)).find((candidate) => candidate.id === job.id)).toBeUndefined();
  });

  it("writes the interpretation result and completes the job in one lifecycle", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const job = await claimReading(readingId);
    await actorTransaction(sql!, userId, (tx) =>
      writeInterpretationResult(tx, {
        userId,
        readingId,
        result: {
          title: "Synthetic",
          directAnswer: "Synthetic direct answer",
          centralTheme: "Synthetic theme",
          cards: [
            {
              positionId: "focus",
              cardId: "major-00",
              orientation: "upright",
              traditionalMeaning: "Synthetic traditional meaning",
              personalizedMeaning: "Synthetic personalized meaning",
              questionConnection: "Synthetic question connection",
            },
          ],
          synthesis: "Synthetic synthesis",
          likelyTrajectory: {
            summary: "Synthetic summary",
            conditions: ["Synthetic condition"],
            alternateTrajectory: "Synthetic alternate trajectory",
          },
          userAgency: ["Synthetic agency"],
          reflectionQuestion: "Synthetic reflection question",
          disconfirmingEvidence: ["Synthetic disconfirming evidence"],
          uncertainty: "Synthetic uncertainty",
          safetyFlags: [],
        },
        provenance: { providerId: "test", promptVersion: "v1", schemaVersion: "reading-result-v1" },
      }),
    );
    await asApp((tx) => completeInterpretationJob(tx, job.id));
    const [jobRow] = await asApp(
      (tx) => tx`select status, completed_at from interpretation_jobs where id = ${job.id}`,
    );
    expect(jobRow?.status).toBe("completed");
    expect(jobRow?.completed_at).not.toBeNull();
    // Raw superuser connection, not asApp/systemTransaction: reading_sessions'
    // RLS is subject-bound (unlike interpretation_jobs), so a role with no
    // request.jwt.claim.sub set would see zero rows here regardless of grants.
    const [reading] = await sql!`select state from reading_sessions where id = ${readingId}`;
    expect(reading?.state).toBe("ready");
  });

  it("marks the owning reading failed", async () => {
    const readingId = await createReading();
    await actorTransaction(sql!, userId, (tx) =>
      markReadingGenerationFailed(tx, { userId, readingId }),
    );
    const [reading] = await sql!`select state from reading_sessions where id = ${readingId}`;
    expect(reading?.state).toBe("failed");
  });

  it("reenqueues a job for immediate retry, resetting attempts and clearing the error", async () => {
    const readingId = await createReading();
    await asApp((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const job = await claimReading(readingId);
    await asApp((tx) => failInterpretationJob(tx, job, "transient"));
    await asApp((tx) => reenqueueInterpretationJob(tx, readingId));
    const [row] = await asApp(
      (tx) =>
        tx`select status, attempt_count, last_error, available_at from interpretation_jobs where reading_id = ${readingId}`,
    );
    expect(row?.status).toBe("pending");
    expect(row?.attempt_count).toBe(0);
    expect(row?.last_error).toBeNull();
    expect(new Date(row!.available_at as string).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("is unreachable from the browser-facing authenticated role", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        return tx`select * from interpretation_jobs limit 1`;
      }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
