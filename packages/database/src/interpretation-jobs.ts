import {
  readingOutputProvenanceSchema,
  readingResultSchema,
  type ReadingOutputProvenance,
  type ReadingResult,
} from "@starguidance/contracts";
import { TAROT_CONTENT_VERSION } from "@starguidance/tarot-content";

import type { DatabaseClient, DatabaseTransaction } from "./postgres-client";

export interface ClaimedInterpretationJob {
  id: string;
  userId: string;
  readingId: string;
  attemptCount: number;
  maxAttempts: number;
}

interface InterpretationJobRow {
  id: string;
  user_id: string;
  reading_id: string;
  attempt_count: number;
  max_attempts: number;
}

function fromRow(row: InterpretationJobRow): ClaimedInterpretationJob {
  return {
    id: row.id,
    userId: row.user_id,
    readingId: row.reading_id,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
  };
}

/**
 * Inserts the job row. Callers should run this inside the same transaction
 * that persists the reading it belongs to (see readingSessions.createLocked
 * in apps/web/src/lib/repositories/postgres.ts) — that's what makes "reading
 * written but its job never was" structurally impossible, rather than a race
 * a crash can still land in.
 */
export async function insertInterpretationJob(
  tx: DatabaseTransaction,
  input: { userId: string; readingId: string },
): Promise<void> {
  await tx`
    insert into interpretation_jobs (user_id, reading_id, deduplication_key)
    values (${input.userId}, ${input.readingId}, ${input.readingId})
  `;
}

/**
 * Atomically claims up to `limit` jobs: fresh pending work, or processing
 * jobs whose lease expired (a crashed prior attempt) — recovery falls out of
 * the normal claim predicate rather than needing a separate sweep query.
 * FOR UPDATE SKIP LOCKED means concurrent callers (a background invocation
 * racing the scheduled sweep's own kick, or two overlapping invocations)
 * never claim the same row twice.
 *
 * Cross-user by design, so run this — like completeInterpretationJob,
 * failInterpretationJob, and getInterpretationQueueStats — on the connection
 * role directly (the interpretation_jobs_system policy, migration 0008), not
 * inside systemTransaction: the starguidance_app policy is subject-bound and
 * a subject-less app-role transaction sees no rows at all.
 */
export async function claimInterpretationJobs(
  client: DatabaseClient | DatabaseTransaction,
  limit: number,
): Promise<ClaimedInterpretationJob[]> {
  const rows = await client<InterpretationJobRow[]>`
    with claimed as (
      select id from interpretation_jobs
      where (status = 'pending' and available_at <= now())
         or (status = 'processing' and lock_expires_at < now())
      order by available_at
      limit ${limit}
      for update skip locked
    )
    update interpretation_jobs
    set status = 'processing',
        locked_at = now(),
        lock_expires_at = now() + interval '2 minutes',
        attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now())
    from claimed
    where interpretation_jobs.id = claimed.id
    returning interpretation_jobs.id, interpretation_jobs.user_id, interpretation_jobs.reading_id,
      interpretation_jobs.attempt_count, interpretation_jobs.max_attempts
  `;
  return rows.map(fromRow);
}

export interface InterpretationQueueStats {
  depth: number;
  oldestPendingAgeSeconds: number | null;
}

/**
 * Reports how much claimable backlog exists right now, using the exact same
 * predicate claimInterpretationJobs() uses to decide what's eligible —
 * counted rather than claimed. Surfaced through the drain route's response
 * so the scheduled trigger (netlify/functions/process-interpretation-jobs.mts)
 * can alert when the backlog is growing across cycles rather than draining.
 * `oldestPendingAgeSeconds` is null when the queue is empty (depth 0).
 */
export async function getInterpretationQueueStats(
  client: DatabaseClient | DatabaseTransaction,
): Promise<InterpretationQueueStats> {
  const [row] = await client<{ depth: number; oldest_pending_age_seconds: number | null }[]>`
    select
      count(*)::integer as depth,
      extract(epoch from (now() - min(available_at))) as oldest_pending_age_seconds
    from interpretation_jobs
    where (status = 'pending' and available_at <= now())
       or (status = 'processing' and lock_expires_at < now())
  `;
  return {
    depth: row?.depth ?? 0,
    oldestPendingAgeSeconds:
      row?.oldest_pending_age_seconds == null ? null : Math.floor(row.oldest_pending_age_seconds),
  };
}

export async function completeInterpretationJob(
  client: DatabaseClient | DatabaseTransaction,
  job: Pick<ClaimedInterpretationJob, "id" | "attemptCount">,
): Promise<boolean> {
  const rows = await client<{ id: string }[]>`
    update interpretation_jobs
    set status = 'completed', completed_at = now()
    where id = ${job.id}
      and status = 'processing'
      and attempt_count = ${job.attemptCount}
    returning id
  `;
  return rows.length === 1;
}

const BACKOFF_CAP_SECONDS = 300;

/**
 * Below max_attempts: returns the job to pending with an exponential,
 * capped backoff so a transient provider failure retries without hammering
 * it. At max_attempts: terminal — status becomes 'failed' and stays
 * claimable by no one; the caller is responsible for also marking the
 * owning reading's generationStatus failed (writeInterpretationResult
 * doesn't run for a terminal failure, so nothing else will).
 */
export async function failInterpretationJob(
  client: DatabaseClient | DatabaseTransaction,
  job: Pick<ClaimedInterpretationJob, "id" | "attemptCount" | "maxAttempts">,
  error: string,
): Promise<{ terminal: boolean; applied: boolean }> {
  const terminal = job.attemptCount >= job.maxAttempts;
  if (terminal) {
    const rows = await client<{ id: string }[]>`
      update interpretation_jobs
      set status = 'failed', last_error = ${error}
      where id = ${job.id}
        and status = 'processing'
        and attempt_count = ${job.attemptCount}
      returning id
    `;
    return { terminal: true, applied: rows.length === 1 };
  }
  const backoffSeconds = Math.min(2 ** job.attemptCount, BACKOFF_CAP_SECONDS);
  const rows = await client<{ id: string }[]>`
    update interpretation_jobs
    set status = 'pending',
        available_at = now() + make_interval(secs => ${backoffSeconds}),
        last_error = ${error}
    where id = ${job.id}
      and status = 'processing'
      and attempt_count = ${job.attemptCount}
    returning id
  `;
  return { terminal: false, applied: rows.length === 1 };
}

/**
 * Re-enqueues an existing job for immediate retry (the user-triggered
 * "retry" action) — resets attempt/backoff state rather than inserting a
 * second row, since deduplication_key already enforces one job per reading.
 */
export async function reenqueueInterpretationJob(
  client: DatabaseClient | DatabaseTransaction,
  readingId: string,
): Promise<void> {
  await client`
    update interpretation_jobs
    set status = 'pending', available_at = now(), attempt_count = 0, last_error = null
    where reading_id = ${readingId}
  `;
}

/**
 * Fences a successful interpretation to its exact claimed attempt, writes
 * the first authoritative output, marks the reading ready, and completes the
 * job in one actor transaction. A reclaimed attempt increments attempt_count,
 * so an older model response cannot write after its lease has expired.
 * Run this inside actorTransaction(client, job.userId, ...) — it does not
 * bind a subject itself, matching every other function in this module.
 */
export async function writeInterpretationResult(
  tx: DatabaseTransaction,
  input: {
    userId: string;
    readingId: string;
    job: Pick<ClaimedInterpretationJob, "id" | "attemptCount">;
    result: ReadingResult;
    provenance: ReadingOutputProvenance;
  },
): Promise<boolean> {
  const provenance = readingOutputProvenanceSchema.parse(input.provenance);
  const result = readingResultSchema.parse(input.result);
  const [activeAttempt] = await tx`
    select id from interpretation_jobs
    where id = ${input.job.id}
      and user_id = ${input.userId}
      and reading_id = ${input.readingId}
      and status = 'processing'
      and attempt_count = ${input.job.attemptCount}
    for update
  `;
  if (!activeAttempt) return false;
  const [reading] = await tx`
    select id from reading_sessions
    where id = ${input.readingId} and user_id = ${input.userId}
    for update
  `;
  if (!reading) throw new Error("INTERPRETATION_JOB_READING_MISSING");
  const [existing] = await tx`
    select id from reading_outputs
    where reading_id = ${input.readingId} and user_id = ${input.userId}
    limit 1
  `;
  if (!existing)
    await tx`
      insert into reading_outputs (
        user_id, reading_id, provider_id, prompt_version, content_version,
        safety_policy_version, schema_version, payload
      ) values (
        ${input.userId}, ${input.readingId}, ${provenance.providerId},
        ${provenance.promptVersion}, ${provenance.contentVersion ?? TAROT_CONTENT_VERSION},
        ${provenance.safetyPolicyVersion ?? "question-safety-v2"},
        ${provenance.schemaVersion}, ${tx.json(JSON.parse(JSON.stringify(result)))}
      )
    `;
  await tx`
    update reading_sessions set state = 'ready', updated_at = now()
    where id = ${input.readingId} and user_id = ${input.userId}
  `;
  const completed = await tx<{ id: string }[]>`
    update interpretation_jobs
    set status = 'completed', completed_at = now()
    where id = ${input.job.id}
      and status = 'processing'
      and attempt_count = ${input.job.attemptCount}
    returning id
  `;
  if (completed.length !== 1) throw new Error("INTERPRETATION_JOB_FENCE_LOST");
  return true;
}

/**
 * Marks the owning reading failed after a job exhausts its retries — the
 * only way the client's existing generationFailed UI/retry button (already
 * wired to generationStatus === "failed") learns a background job gave up,
 * since writeInterpretationResult never runs for a terminal failure.
 */
export async function markReadingGenerationFailed(
  tx: DatabaseTransaction,
  input: { userId: string; readingId: string },
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    update reading_sessions set state = 'failed', updated_at = now()
    where id = ${input.readingId} and user_id = ${input.userId}
      and state <> 'ready'
      and not exists (
        select 1 from reading_outputs
        where reading_id = ${input.readingId} and user_id = ${input.userId}
      )
    returning id
  `;
  return rows.length === 1;
}
