import type { DatabaseClient, DatabaseTransaction } from "./postgres-client";

/**
 * Completed jobs stay visible this long for observability (correlating a
 * reading's latency with its job attempts), then become garbage: the result
 * itself lives in reading_outputs, so a completed row carries no further
 * state anyone reads.
 */
export const COMPLETED_JOB_RETENTION_HOURS = 24;

export interface SystemPruneSummary {
  expiredRateLimitBuckets: number;
  completedInterpretationJobs: number;
}

/**
 * Opportunistic garbage collection for the two unbounded-growth system
 * tables (gap G12), piggybacked on the every-minute scheduled drain so no
 * separate scheduler exists to misconfigure. Runs on the connection role,
 * like the drain itself.
 *
 * Deletes only what is garbage by definition: rate-limit buckets past their
 * own expires_at, and completed interpretation jobs past the observability
 * window. Failed jobs are deliberately NOT pruned here — they are the
 * queue's only dead-letter record (nothing else surfaces status='failed'),
 * so removing them is an operator decision made through the guarded
 * retention command (apply-retention.ts) with an explicit approved cutoff.
 */
export async function pruneExpiredSystemRows(
  client: DatabaseClient | DatabaseTransaction,
): Promise<SystemPruneSummary> {
  const buckets = await client`
    delete from rate_limit_buckets where expires_at < now()
  `;
  const jobs = await client`
    delete from interpretation_jobs
    where status = 'completed'
      and completed_at < now() - make_interval(hours => ${COMPLETED_JOB_RETENTION_HOURS})
  `;
  return {
    expiredRateLimitBuckets: buckets.count,
    completedInterpretationJobs: jobs.count,
  };
}
