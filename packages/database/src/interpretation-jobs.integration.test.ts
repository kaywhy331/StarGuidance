import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  claimInterpretationJobs,
  completeInterpretationJob,
  failInterpretationJob,
  getInterpretationQueueStats,
  insertInterpretationJob,
  markReadingGenerationFailed,
  reenqueueInterpretationJob,
  writeInterpretationResult,
  type ClaimedInterpretationJob,
} from "./interpretation-jobs";
import { createDatabaseClient, type DatabaseTransaction } from "./postgres-client";
import { pruneExpiredSystemRows } from "./system-prune";
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

/**
 * The worker's path: the connection role, matching interpretation-worker.ts
 * after migration 0008 (the interpretation_jobs_system policy). Claim,
 * complete, fail, and test-only row surgery all run here — a subject-less
 * starguidance_app transaction deliberately sees no rows anymore.
 */
async function asWorker<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return sql.begin((tx) => work(tx as DatabaseTransaction)) as Promise<T>;
}

/**
 * The request path: starguidance_app bound to this suite's subject, exactly
 * how POST /api/readings enqueues and how the retry route re-enqueues.
 */
async function asUser<T>(work: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
  if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
  return actorTransaction(sql, userId, work);
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
  return asWorker((tx) => claimInterpretationJobs(tx, limit));
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
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    await expect(
      asUser((tx) => insertInterpretationJob(tx, { userId, readingId })),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("claims a pending job exactly once and leaves it unclaimable again immediately", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const claimed = await claimReading(readingId);
    expect(claimed.attemptCount).toBe(1);
    const secondAttempt = await claim(50);
    expect(secondAttempt.find((job) => job.readingId === readingId)).toBeUndefined();
  });

  it("serializes concurrent claims so exactly one caller gets a given job (FOR UPDATE SKIP LOCKED)", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const results = await Promise.all(Array.from({ length: 5 }, () => claim(1)));
    const winners = results.filter((jobs) => jobs.some((job) => job.readingId === readingId));
    expect(winners).toHaveLength(1);
  });

  it("reclaims a job whose lease expired without a completion", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    await claimReading(readingId);
    await asWorker(
      (tx) => tx`
      update interpretation_jobs set lock_expires_at = now() - interval '1 second'
      where reading_id = ${readingId}
    `,
    );
    const reclaimed = await claimReading(readingId);
    expect(reclaimed.attemptCount).toBe(2);
  });

  it("fences stale completion and failure after a lease is reclaimed", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const staleAttempt = await claimReading(readingId);
    await asWorker(
      (tx) => tx`
        update interpretation_jobs set lock_expires_at = now() - interval '1 second'
        where id = ${staleAttempt.id}
      `,
    );
    const currentAttempt = await claimReading(readingId);

    expect(await asWorker((tx) => completeInterpretationJob(tx, staleAttempt))).toBe(false);
    expect(
      await asWorker((tx) => failInterpretationJob(tx, staleAttempt, "stale-failure")),
    ).toEqual({ terminal: false, applied: false });
    const [processing] = await asWorker(
      (tx) =>
        tx`select status, attempt_count from interpretation_jobs where id = ${currentAttempt.id}`,
    );
    expect(processing?.status).toBe("processing");
    expect(processing?.attempt_count).toBe(currentAttempt.attemptCount);

    expect(await asWorker((tx) => completeInterpretationJob(tx, currentAttempt))).toBe(true);
    const [completed] = await asWorker(
      (tx) =>
        tx`select status, attempt_count from interpretation_jobs where id = ${currentAttempt.id}`,
    );
    expect(completed?.status).toBe("completed");
    expect(completed?.attempt_count).toBe(currentAttempt.attemptCount);
  });

  it("returns a failed job to pending with capped exponential backoff until max_attempts, then terminates it", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    let job = await claimReading(readingId);
    expect(job.maxAttempts).toBe(5);
    for (let attempt = job.attemptCount; attempt < job.maxAttempts; attempt += 1) {
      const before = Date.now();
      const outcome = await asWorker((tx) => failInterpretationJob(tx, job, `attempt-${attempt}`));
      expect(outcome.terminal).toBe(false);
      expect(outcome.applied).toBe(true);
      const [row] = await asWorker(
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
      await asWorker(
        (tx) => tx`update interpretation_jobs set available_at = now() where id = ${job.id}`,
      );
      job = await claimReading(readingId);
    }
    const finalOutcome = await asWorker((tx) => failInterpretationJob(tx, job, "final-failure"));
    expect(finalOutcome.terminal).toBe(true);
    expect(finalOutcome.applied).toBe(true);
    const [row] = await asWorker(
      (tx) => tx`select status from interpretation_jobs where id = ${job.id}`,
    );
    expect(row?.status).toBe("failed");
    expect((await claim(50)).find((candidate) => candidate.id === job.id)).toBeUndefined();
  });

  it("writes the interpretation result and completes the job in one lifecycle", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const job = await claimReading(readingId);
    expect(
      await actorTransaction(sql!, userId, (tx) =>
        writeInterpretationResult(tx, {
          userId,
          readingId,
          job,
          result: {
            schemaVersion: "reading-result-v2",
            title: "Synthetic",
            passages: [
              {
                id: "opening",
                role: "opening",
                text: "Synthetic opening narration.",
                cardReferences: ["focus"],
              },
              {
                id: "trajectory",
                role: "trajectory",
                text: "Synthetic likely trajectory.",
                cardReferences: ["focus"],
              },
              {
                id: "alternate",
                role: "alternative",
                text: "Synthetic alternate trajectory.",
                cardReferences: [],
              },
            ],
            cards: [
              {
                positionId: "focus",
                cardId: "major-00",
                orientation: "upright",
                passageIds: ["opening", "trajectory"],
              },
            ],
            trajectory: {
              likelyPassageId: "trajectory",
              conditions: ["Synthetic condition"],
              alternatePassageId: "alternate",
            },
            userAgency: ["Synthetic agency"],
            reflectionQuestion: "Synthetic reflection question",
            disconfirmingEvidence: ["Synthetic disconfirming evidence"],
            uncertainty: "Synthetic uncertainty",
            safetyFlags: [],
          },
          provenance: {
            providerId: "test",
            promptVersion: "v2",
            schemaVersion: "reading-result-v2",
          },
        }),
      ),
    ).toBe(true);
    const [jobRow] = await asWorker(
      (tx) => tx`select status, completed_at from interpretation_jobs where id = ${job.id}`,
    );
    expect(jobRow?.status).toBe("completed");
    expect(jobRow?.completed_at).not.toBeNull();
    // Raw connection-role query: reading_sessions' RLS is subject-bound, so a
    // starguidance_app transaction with no request.jwt.claim.sub set would see
    // zero rows here regardless of grants.
    const [reading] = await sql!`select state from reading_sessions where id = ${readingId}`;
    expect(reading?.state).toBe("ready");
  });

  it("allows only one concurrent result write for a claimed attempt", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const job = await claimReading(readingId);
    const input = {
      userId,
      readingId,
      job,
      result: {
        schemaVersion: "reading-result-v2" as const,
        title: "Authoritative synthetic result",
        passages: [
          {
            id: "opening",
            role: "opening" as const,
            text: "Synthetic opening narration.",
            cardReferences: ["focus"],
          },
          {
            id: "trajectory",
            role: "trajectory" as const,
            text: "Synthetic likely trajectory.",
            cardReferences: ["focus"],
          },
          {
            id: "alternate",
            role: "alternative" as const,
            text: "Synthetic alternate trajectory.",
            cardReferences: [],
          },
        ],
        cards: [
          {
            positionId: "focus",
            cardId: "major-00",
            orientation: "upright" as const,
            passageIds: ["opening", "trajectory"],
          },
        ],
        trajectory: {
          likelyPassageId: "trajectory",
          conditions: ["Synthetic condition"],
          alternatePassageId: "alternate",
        },
        userAgency: ["Synthetic agency"],
        reflectionQuestion: "Synthetic reflection question",
        disconfirmingEvidence: ["Synthetic disconfirming evidence"],
        uncertainty: "Synthetic uncertainty",
        safetyFlags: [],
      },
      provenance: {
        providerId: "test",
        promptVersion: "v2",
        schemaVersion: "reading-result-v2" as const,
      },
    };

    const outcomes = await Promise.all([
      actorTransaction(sql!, userId, (tx) => writeInterpretationResult(tx, input)),
      actorTransaction(sql!, userId, (tx) => writeInterpretationResult(tx, input)),
    ]);

    expect(outcomes.sort()).toEqual([false, true]);
    const [row] = await sql!`
      select count(*)::integer as count, min(payload->>'title') as title
      from reading_outputs where reading_id = ${readingId}
    `;
    expect(row?.count).toBe(1);
    expect(row?.title).toBe("Authoritative synthetic result");
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
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const job = await claimReading(readingId);
    await asWorker((tx) => failInterpretationJob(tx, job, "transient"));
    await asUser((tx) => reenqueueInterpretationJob(tx, readingId));
    const [row] = await asWorker(
      (tx) =>
        tx`select status, attempt_count, last_error, available_at from interpretation_jobs where reading_id = ${readingId}`,
    );
    expect(row?.status).toBe("pending");
    expect(row?.attempt_count).toBe(0);
    expect(row?.last_error).toBeNull();
    expect(new Date(row!.available_at as string).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // Every test in this file shares one interpretation_jobs table (see
  // claimReading's own comment above), so these assert deltas/floors around
  // one known mutation rather than absolute counts — an absolute `toBe(1)`
  // would be flaky against whatever earlier tests left claimable.
  it("counts a newly inserted job in the queue depth", async () => {
    const before = await getInterpretationQueueStats(sql!);
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const after = await getInterpretationQueueStats(sql!);
    expect(after.depth).toBe(before.depth + 1);
  });

  it("excludes a job that is processing with an unexpired lease", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const before = await getInterpretationQueueStats(sql!);
    expect(before.depth).toBeGreaterThanOrEqual(1);
    // claimReading claims up to 50 — everything currently claimable in the
    // shared table, not just this test's row — and moves each into
    // `processing` with a 2-minute lease. With well under 50 rows in play,
    // that exhaustively drains the claimable set, so depth lands at exactly
    // zero rather than merely one less than `before`.
    await claimReading(readingId);
    const after = await getInterpretationQueueStats(sql!);
    expect(after.depth).toBe(0);
  });

  it("reports how long the oldest claimable job has been waiting", async () => {
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    // Backdate this job so it is unambiguously the oldest claimable row,
    // regardless of whatever else earlier tests left in the shared table:
    // the table-wide minimum can only be at or before this timestamp.
    await asWorker(
      (tx) => tx`
        update interpretation_jobs set available_at = now() - interval '90 seconds'
        where reading_id = ${readingId}
      `,
    );
    const stats = await getInterpretationQueueStats(sql!);
    expect(stats.oldestPendingAgeSeconds).not.toBeNull();
    expect(stats.oldestPendingAgeSeconds!).toBeGreaterThanOrEqual(90);
  });

  it("prunes expired buckets and stale completed jobs, never failed or fresh rows", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const staleReading = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId: staleReading }));
    const staleJob = await claimReading(staleReading);
    await asWorker((tx) => completeInterpretationJob(tx, staleJob));
    await asWorker(
      (tx) => tx`
        update interpretation_jobs set completed_at = now() - interval '25 hours'
        where id = ${staleJob.id}`,
    );
    const freshReading = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId: freshReading }));
    const freshJob = await claimReading(freshReading);
    await asWorker((tx) => completeInterpretationJob(tx, freshJob));
    await sql`insert into rate_limit_buckets (key_hash, window_start, count, expires_at) values
      ('prune-test-expired', now() - interval '2 hours', 1, now() - interval '1 hour'),
      ('prune-test-live', now(), 1, now() + interval '1 hour')`;
    try {
      const summary = await pruneExpiredSystemRows(sql);
      expect(summary.completedInterpretationJobs).toBeGreaterThanOrEqual(1);
      expect(summary.expiredRateLimitBuckets).toBeGreaterThanOrEqual(1);
      const [stale] = await sql`
        select count(*)::int as count from interpretation_jobs where id = ${staleJob.id}`;
      expect(stale?.count).toBe(0);
      const [fresh] = await sql`
        select count(*)::int as count from interpretation_jobs where id = ${freshJob.id}`;
      expect(fresh?.count).toBe(1);
      // The terminal failure the backoff test left behind is the dead-letter
      // record — pruning must never touch status='failed'.
      const [failed] = await sql`
        select count(*)::int as count from interpretation_jobs where status = 'failed'`;
      expect(failed?.count).toBeGreaterThanOrEqual(1);
      const buckets = await sql`
        select key_hash from rate_limit_buckets where key_hash like 'prune-test-%'`;
      expect(buckets.map((row) => row.key_hash)).toEqual(["prune-test-live"]);
    } finally {
      await sql`delete from rate_limit_buckets where key_hash like 'prune-test-%'`;
    }
  });

  it("hides and protects one subject's jobs from an actor bound to another subject", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const other = await createSubject(sql, mode, "interp-jobs-other");
    await sql`insert into users (id, email) values (${other.id}, ${other.email})`;
    try {
      const visible = await actorTransaction(
        sql,
        other.id,
        (tx) => tx`select id from interpretation_jobs where reading_id = ${readingId}`,
      );
      expect(visible).toHaveLength(0);
      const updated = await actorTransaction(
        sql,
        other.id,
        (tx) =>
          tx`update interpretation_jobs set status = 'failed'
             where reading_id = ${readingId} returning id`,
      );
      expect(updated).toHaveLength(0);
      // Nor can an actor forge a job attributed to someone else: WITH CHECK
      // rejects the cross-subject insert outright.
      await expect(
        actorTransaction(sql, other.id, (tx) => insertInterpretationJob(tx, { userId, readingId })),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await sql`delete from users where id = ${other.id}`;
      await deleteSubject(sql, mode, other).catch(() => undefined);
    }
  });

  it("shows a subject-less app-role transaction no job rows at all", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const readingId = await createReading();
    await asUser((tx) => insertInterpretationJob(tx, { userId, readingId }));
    const rows = await systemTransaction(sql, (tx) => tx`select id from interpretation_jobs`);
    expect(rows).toHaveLength(0);
    const orphanReading = await createReading();
    await expect(
      systemTransaction(sql, (tx) =>
        insertInterpretationJob(tx, { userId, readingId: orphanReading }),
      ),
    ).rejects.toMatchObject({ code: "42501" });
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
