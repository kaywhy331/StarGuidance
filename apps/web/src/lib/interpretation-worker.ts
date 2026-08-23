import "server-only";

import {
  actorTransaction,
  claimInterpretationJobs,
  failInterpretationJob,
  markReadingGenerationFailed,
  writeInterpretationResult,
  type ClaimedInterpretationJob,
  type DatabaseClient,
} from "@starguidance/database";
import { createInterpretationProvider, readingLensStatements } from "@starguidance/ai";

import { persistenceFor } from "./persistence";
import {
  classifyProductProvider,
  productDurationBucket,
  productModelVersion,
  tryRecordProductEvent,
} from "./product-telemetry";
import { getRuntimeAdapter, getSystemDatabaseClient } from "./runtime";
import {
  getRuntimeConfiguration,
  interpretationRuntimeOptions,
  type RuntimeConfiguration,
} from "./runtime-configuration";

export interface InterpretationJobsRunSummary {
  claimed: number;
  succeeded: number;
  failed: number;
}

export function interpretationFailureCode(error: unknown): string {
  if (!(error instanceof Error)) return "interpretation_generation_failed";
  if (error.message === "INTERPRETATION_JOB_READING_MISSING")
    return "interpretation_reading_missing";
  if (error.message.includes("authenticate")) return "interpretation_source_authentication_failed";
  if (error.name === "ZodError" || error instanceof SyntaxError)
    return "interpretation_source_invalid";
  if (error.message === "request-timeout") return "interpretation_provider_timeout";
  const providerFailureClasses: Readonly<Record<string, string>> = {
    authentication: "interpretation_provider_authentication",
    "rate-limited": "interpretation_provider_rate_limited",
    "provider-unavailable": "interpretation_provider_unavailable",
    "request-rejected": "interpretation_provider_request_rejected",
    "invalid-response": "interpretation_provider_invalid_response",
    "unsafe-response": "interpretation_provider_unsafe_response",
  };
  const providerFailureClass = providerFailureClasses[error.message];
  if (providerFailureClass) return providerFailureClass;
  return "interpretation_generation_failed";
}

/**
 * Processes one claimed job: read the locked reading + the profile snapshot
 * it was drawn against, reconstruct the same trait statements the retry
 * handler builds today (apps/web/src/app/api/readings/[id]/route.ts), call
 * the provider, and persist. Never throws — a processing failure is recorded
 * via failInterpretationJob/markReadingGenerationFailed, not propagated,
 * so one bad job can't stop the rest of the batch.
 */
async function processJob(
  sql: DatabaseClient,
  job: ClaimedInterpretationJob,
  runtimeConfiguration: RuntimeConfiguration,
): Promise<boolean> {
  let generationStartedAt: number | undefined;
  if (job.attemptCount > 1)
    await tryRecordProductEvent({
      idempotencyKey: `interpretation-job:${job.id}:attempt:${job.attemptCount}`,
      name: "job_retried",
      properties: { statusClass: "started" },
    });
  try {
    const persistence = persistenceFor({ id: job.userId });
    const reading = await persistence.repositories.readingSessions.get(job.userId, job.readingId);
    if (!reading) throw new Error("INTERPRETATION_JOB_READING_MISSING");
    const snapshot = (
      await persistence.repositories.profileSnapshots.get(job.userId, reading.profileSnapshotId)
    )?.snapshot;
    const relevantTraitStatements =
      reading.configuration.personalizationMode === "personalized_tarot" && snapshot
        ? readingLensStatements(reading.readingLens, snapshot.traits, snapshot.tensions)
        : [];
    generationStartedAt = Date.now();
    const generated = await createInterpretationProvider(
      interpretationRuntimeOptions(runtimeConfiguration),
    ).generateWithProvenance({
      draw: reading.draw,
      configuration: reading.configuration,
      question: persistence.decrypt(reading.encryptedQuestion, "reading-question"),
      questionClassification: reading.questionClassification,
      relevantTraitStatements,
    });
    const written = await actorTransaction(sql, job.userId, (tx) =>
      writeInterpretationResult(tx, {
        userId: job.userId,
        readingId: job.readingId,
        job,
        result: generated.result,
        provenance: {
          ...generated.provenance,
          contentVersion: runtimeConfiguration.content.tarotContentVersion,
          safetyPolicyVersion: runtimeConfiguration.prompts.safetyPolicyVersion,
        },
      }),
    );
    const provider = classifyProductProvider(generated.provenance.providerId);
    await tryRecordProductEvent({
      idempotencyKey: `reading:${job.readingId}:generation-completed`,
      name: "generation_completed",
      properties: {
        provider,
        modelVersion: productModelVersion(generated.provenance.providerId),
        generationMode: provider === "deterministic" ? "deterministic" : "live",
        fallbackUsed: provider === "deterministic",
        durationBucket: productDurationBucket(Date.now() - generationStartedAt),
        statusClass: "ready",
      },
    });
    if (provider === "deterministic")
      await tryRecordProductEvent({
        idempotencyKey: `reading:${job.readingId}:fallback-used`,
        name: "fallback_used",
        properties: {
          provider,
          modelVersion: productModelVersion(generated.provenance.providerId),
          generationMode: "deterministic",
          fallbackUsed: true,
          statusClass: "ready",
        },
      });
    return written;
  } catch (error) {
    const code = interpretationFailureCode(error);
    await actorTransaction(sql, job.userId, async (tx) => {
      const { terminal, applied } = await failInterpretationJob(tx, job, code);
      if (terminal && applied)
        await markReadingGenerationFailed(tx, {
          userId: job.userId,
          readingId: job.readingId,
        });
    });
    await tryRecordProductEvent({
      idempotencyKey: `reading:${job.readingId}:generation-failed:attempt:${job.attemptCount}`,
      name: "generation_failed",
      properties: {
        errorClass: code.includes("timeout")
          ? "provider_timeout"
          : code.includes("rate_limited")
            ? "rate_limited"
            : code.includes("invalid")
              ? "schema_invalid"
              : code.includes("authentication")
                ? "authentication"
                : "unclassified",
        ...(generationStartedAt === undefined
          ? {}
          : { durationBucket: productDurationBucket(Date.now() - generationStartedAt) }),
        statusClass: "failed",
      },
    });
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
  // Cross-user claims run directly on the connection role via the explicit
  // interpretation_jobs_system policy (migration 0008). Once claimed, every
  // result/failure transition is attempt-fenced inside actorTransaction so
  // subject-bound RLS and the owning reading update share one transaction.
  const sql = getSystemDatabaseClient();
  const runtimeConfiguration = await getRuntimeConfiguration();
  const maximum = Math.max(0, Math.floor(limit));
  let claimed = 0;
  let succeeded = 0;
  let failed = 0;

  // Claim immediately before processing instead of leasing the whole batch
  // up front. A live model chain can consume most of its 40-second deadline;
  // pre-claiming ten serial jobs would let later leases expire before their
  // work began and make an overlapping scheduled invocation reclaim them.
  for (let processed = 0; processed < maximum; processed += 1) {
    const [job] = await claimInterpretationJobs(sql, 1);
    if (!job) break;
    claimed += 1;
    if (await processJob(sql, job, runtimeConfiguration)) succeeded += 1;
    else failed += 1;
  }
  return { claimed, succeeded, failed };
}
