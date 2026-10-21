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
  completedReportJobs: number;
  expiredGuestReadingDeletionFences: number;
}

/**
 * Opportunistic garbage collection for the unbounded-growth system tables
 * (gap G12), piggybacked on the every-minute scheduled drain so no
 * separate scheduler exists to misconfigure. Runs on the connection role,
 * like the drain itself.
 *
 * Deletes only what is garbage by definition: rate-limit buckets past their
 * own expires_at, completed interpretation jobs past the observability
 * window, and guest-reading deletion fences whose receipt has expired (an
 * expired receipt is refused before any import, so the fence guards
 * nothing). Failed jobs are deliberately NOT pruned here — they are the
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
  const reportJobs = await client`
    delete from report_jobs
    where status = 'completed'
      and completed_at < now() - make_interval(hours => ${COMPLETED_JOB_RETENTION_HOURS})
  `;
  const fences = await client`
    delete from guest_reading_deletion_fences where expires_at < now()
  `;
  return {
    expiredRateLimitBuckets: buckets.count,
    completedInterpretationJobs: jobs.count,
    completedReportJobs: reportJobs.count,
    expiredGuestReadingDeletionFences: fences.count,
  };
}
