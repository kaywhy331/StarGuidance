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

export async function completeInterpretationJob(
  client: DatabaseClient | DatabaseTransaction,
  jobId: string,
): Promise<void> {
  await client`
    update interpretation_jobs
    set status = 'completed', completed_at = now()
    where id = ${jobId}
  `;
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
): Promise<{ terminal: boolean }> {
  const terminal = job.attemptCount >= job.maxAttempts;
  if (terminal) {
    await client`
      update interpretation_jobs
      set status = 'failed', last_error = ${error}
      where id = ${job.id}
    `;
    return { terminal: true };
  }
  const backoffSeconds = Math.min(2 ** job.attemptCount, BACKOFF_CAP_SECONDS);
  await client`
    update interpretation_jobs
    set status = 'pending',
        available_at = now() + make_interval(secs => ${backoffSeconds}),
        last_error = ${error}
    where id = ${job.id}
  `;
  return { terminal: false };
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
 * Writes a successful interpretation exactly like the Next.js request path
 * does today (outputs.save in apps/web/src/lib/repositories/postgres.ts):
 * insert reading_outputs, then mark the reading ready, in one transaction.
 * Run this inside actorTransaction(client, job.userId, ...) — it does not
 * bind a subject itself, matching every other function in this module.
 */
export async function writeInterpretationResult(
  tx: DatabaseTransaction,
  input: {
    userId: string;
    readingId: string;
    result: ReadingResult;
    provenance: ReadingOutputProvenance;
  },
): Promise<void> {
  const provenance = readingOutputProvenanceSchema.parse(input.provenance);
  const result = readingResultSchema.parse(input.result);
  await tx`
    insert into reading_outputs (
      user_id, reading_id, provider_id, prompt_version, content_version, schema_version, payload
    ) values (
      ${input.userId}, ${input.readingId}, ${provenance.providerId},
      ${provenance.promptVersion}, ${TAROT_CONTENT_VERSION},
      ${provenance.schemaVersion}, ${tx.json(JSON.parse(JSON.stringify(result)))}
    )
  `;
  await tx`
    update reading_sessions set state = 'ready', updated_at = now()
    where id = ${input.readingId} and user_id = ${input.userId}
  `;
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
): Promise<void> {
  await tx`
    update reading_sessions set state = 'failed', updated_at = now()
    where id = ${input.readingId} and user_id = ${input.userId}
  `;
}
