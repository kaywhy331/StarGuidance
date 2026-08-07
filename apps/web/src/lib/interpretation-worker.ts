import "server-only";

import {
  actorTransaction,
  claimInterpretationJobs,
  completeInterpretationJob,
  failInterpretationJob,
  markReadingGenerationFailed,
  systemTransaction,
  writeInterpretationResult,
  type ClaimedInterpretationJob,
  type DatabaseClient,
} from "@starguidance/database";
import { createInterpretationProvider } from "@starguidance/ai";

import { persistenceFor } from "./persistence";
import { getRuntimeAdapter, getSystemDatabaseClient } from "./runtime";

export interface InterpretationJobsRunSummary {
  claimed: number;
  succeeded: number;
  failed: number;
}

/**
 * Processes one claimed job: read the locked reading + the profile snapshot
 * it was drawn against, reconstruct the same trait statements the retry
 * handler builds today (apps/web/src/app/api/readings/[id]/route.ts), call
 * the provider, and persist. Never throws — a processing failure is recorded
 * via failInterpretationJob/markReadingGenerationFailed, not propagated,
 * so one bad job can't stop the rest of the batch.
 */
async function processJob(sql: DatabaseClient, job: ClaimedInterpretationJob): Promise<boolean> {
  try {
    const persistence = persistenceFor({ id: job.userId });
    const reading = await persistence.repositories.readingSessions.get(job.userId, job.readingId);
    if (!reading) throw new Error("INTERPRETATION_JOB_READING_MISSING");
    const snapshot = (
      await persistence.repositories.profileSnapshots.get(job.userId, reading.profileSnapshotId)
    )?.snapshot;
    const relevantTraitStatements = snapshot
      ? reading.readingLens.traitIndexes.map((index) => snapshot.traits[index]?.statement ?? "")
      : [];
    const generated = await createInterpretationProvider().generateWithProvenance({
      draw: reading.draw,
      question: persistence.decrypt(reading.encryptedQuestion),
      relevantTraitStatements,
    });
    await actorTransaction(sql, job.userId, (tx) =>
      writeInterpretationResult(tx, {
        userId: job.userId,
        readingId: job.readingId,
        result: generated.result,
        provenance: generated.provenance,
      }),
    );
    await systemTransaction(sql, (tx) => completeInterpretationJob(tx, job.id));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown interpretation job failure.";
    const { terminal } = await systemTransaction(sql, (tx) => failInterpretationJob(tx, job, message));
    if (terminal)
      await actorTransaction(sql, job.userId, (tx) =>
        markReadingGenerationFailed(tx, { userId: job.userId, readingId: job.readingId }),
      );
    return false;
  }
}

/**
 * Drains up to `limit` claimable interpretation jobs. A no-op on the local
 * runtime adapter — it has no interpretation_jobs table and never runs on
 * Netlify, so it keeps generating synchronously (see
 * apps/web/src/lib/repositories/local.ts) rather than going through this
 * queue at all.
 *
 * Called two ways: inline, for one job right after it's enqueued (the fast
 * path — keeps today's near-synchronous latency in the common case), and
 * from POST /api/internal/interpretation-jobs on a larger batch (the
 * Netlify-scheduled durability backstop for whatever the fast path missed —
 * a serverless interruption mid-request, a transient provider failure).
 */
export async function runInterpretationJobs(limit: number): Promise<InterpretationJobsRunSummary> {
  if (getRuntimeAdapter() !== "supabase") return { claimed: 0, succeeded: 0, failed: 0 };
  const sql = getSystemDatabaseClient();
  const claimed = await systemTransaction(sql, (tx) => claimInterpretationJobs(tx, limit));
  let succeeded = 0;
  let failed = 0;
  for (const job of claimed) {
    if (await processJob(sql, job)) succeeded += 1;
    else failed += 1;
  }
  return { claimed: claimed.length, succeeded, failed };
}
