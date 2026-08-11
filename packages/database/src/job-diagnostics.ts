import type { DatabaseClient, DatabaseTransaction } from "./postgres-client";

export const INTERPRETATION_FAILURE_CLASSES = [
  "interpretation_reading_missing",
  "interpretation_source_authentication_failed",
  "interpretation_source_invalid",
  "interpretation_provider_timeout",
  "interpretation_provider_authentication",
  "interpretation_provider_rate_limited",
  "interpretation_provider_unavailable",
  "interpretation_provider_request_rejected",
  "interpretation_provider_invalid_response",
  "interpretation_provider_unsafe_response",
  "interpretation_generation_failed",
] as const;

export const REPORT_FAILURE_CLASSES = [
  "report_source_authentication_failed",
  "report_source_invalid",
  "report_generation_failed",
] as const;

type QueueName = "interpretation" | "report";

interface DiagnosticRow {
  queue: QueueName;
  status: string;
  failure_class: string | null;
  count: number;
}

export interface QueueDiagnostic {
  statuses: Record<string, number>;
  failedByClass: Record<string, number>;
}

export interface JobQueueDiagnostics {
  interpretation: QueueDiagnostic;
  report: QueueDiagnostic;
}

export function buildJobQueueDiagnostics(rows: readonly DiagnosticRow[]): JobQueueDiagnostics {
  const result: JobQueueDiagnostics = {
    interpretation: { statuses: {}, failedByClass: {} },
    report: { statuses: {}, failedByClass: {} },
  };
  for (const row of rows) {
    const queue = result[row.queue];
    if (row.failure_class) queue.failedByClass[row.failure_class] = row.count;
    else queue.statuses[row.status] = row.count;
  }
  return result;
}

/**
 * Read-only, aggregate diagnostics for the two durable queues. The SQL maps
 * every stored error to a closed class before it leaves Postgres. Legacy or
 * unexpected values become `*_unclassified`; raw last_error, identifiers,
 * source ciphertext, questions, and report content are never returned.
 */
export async function inspectJobQueues(
  client: DatabaseClient | DatabaseTransaction,
): Promise<JobQueueDiagnostics> {
  const rows = await client<DiagnosticRow[]>`
    with status_counts as (
      select 'interpretation'::text as queue, status, count(*)::integer as count
      from interpretation_jobs group by status
      union all
      select 'report'::text as queue, status, count(*)::integer as count
      from report_jobs group by status
    ), failure_counts as (
      select 'interpretation'::text as queue,
        case
          when last_error in (
            'interpretation_reading_missing',
            'interpretation_source_authentication_failed',
            'interpretation_source_invalid',
            'interpretation_provider_timeout',
            'interpretation_provider_authentication',
            'interpretation_provider_rate_limited',
            'interpretation_provider_unavailable',
            'interpretation_provider_request_rejected',
            'interpretation_provider_invalid_response',
            'interpretation_provider_unsafe_response',
            'interpretation_generation_failed'
          ) then last_error
          else 'interpretation_unclassified'
        end as failure_class,
        count(*)::integer as count
      from interpretation_jobs where status = 'failed'
      group by failure_class
      union all
      select 'report'::text as queue,
        case
          when last_error in (
            'report_source_authentication_failed',
            'report_source_invalid',
            'report_generation_failed'
          ) then last_error
          else 'report_unclassified'
        end as failure_class,
        count(*)::integer as count
      from report_jobs where status = 'failed'
      group by failure_class
    )
    select queue, status, null::text as failure_class, count from status_counts
    union all
    select queue, 'failed'::text as status, failure_class, count from failure_counts
    order by queue, failure_class nulls first, status
  `;
  return buildJobQueueDiagnostics(rows);
}
