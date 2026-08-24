import type { StoredReportSection } from "./repositories";
import type { DatabaseClient, DatabaseJsonValue, DatabaseTransaction } from "./postgres-client";

export interface ClaimedReportJob {
  id: string;
  userId: string;
  reportId: string;
  encryptedSource: string;
  attemptCount: number;
  maxAttempts: number;
}

interface ReportJobRow {
  id: string;
  user_id: string;
  report_id: string;
  encrypted_source: string;
  attempt_count: number;
  max_attempts: number;
}

function fromRow(row: ReportJobRow): ClaimedReportJob {
  return {
    id: row.id,
    userId: row.user_id,
    reportId: row.report_id,
    encryptedSource: row.encrypted_source,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
  };
}

/**
 * Production workers omit `scope` and drain the global queue. Credentialed
 * integration tests supply their synthetic report ID so verification never
 * leases retained beta work from another account.
 */
export async function claimReportJobs(
  client: DatabaseClient | DatabaseTransaction,
  limit: number,
  scope?: { reportId: string },
): Promise<ClaimedReportJob[]> {
  const scopedReportId = scope?.reportId ?? null;
  const rows = await client<ReportJobRow[]>`
    with claimed as (
      select id from report_jobs
      where encrypted_source is not null
        and (
          (status = 'pending' and available_at <= now())
          or (status = 'processing' and lock_expires_at < now())
        )
        and (${scopedReportId}::uuid is null or report_id = ${scopedReportId}::uuid)
      order by available_at
      limit ${limit}
      for update skip locked
    )
    update report_jobs
    set status = 'processing',
        locked_at = now(),
        lock_expires_at = now() + interval '2 minutes',
        attempt_count = attempt_count + 1,
        started_at = coalesce(started_at, now())
    from claimed
    where report_jobs.id = claimed.id
    returning report_jobs.id, report_jobs.user_id, report_jobs.report_id,
      report_jobs.encrypted_source, report_jobs.attempt_count, report_jobs.max_attempts
  `;
  return rows.map(fromRow);
}

export interface ReportQueueStats {
  depth: number;
  oldestPendingAgeSeconds: number | null;
}

export async function getReportQueueStats(
  client: DatabaseClient | DatabaseTransaction,
): Promise<ReportQueueStats> {
  const [row] = await client<{ depth: number; oldest_pending_age_seconds: number | null }[]>`
    select
      count(*)::integer as depth,
      extract(epoch from (now() - min(available_at))) as oldest_pending_age_seconds
    from report_jobs
    where encrypted_source is not null
      and (
        (status = 'pending' and available_at <= now())
        or (status = 'processing' and lock_expires_at < now())
      )
  `;
  return {
    depth: row?.depth ?? 0,
    oldestPendingAgeSeconds:
      row?.oldest_pending_age_seconds == null ? null : Math.floor(row.oldest_pending_age_seconds),
  };
}

export async function completeReportJob(
  client: DatabaseClient | DatabaseTransaction,
  jobId: string,
): Promise<void> {
  await client`
    update report_jobs
    set status = 'completed', completed_at = now(), encrypted_source = null,
        locked_at = null, lock_expires_at = null, last_error = null
    where id = ${jobId}
  `;
}

const BACKOFF_CAP_SECONDS = 300;

export async function failReportJob(
  client: DatabaseClient | DatabaseTransaction,
  job: Pick<ClaimedReportJob, "id" | "attemptCount" | "maxAttempts">,
  failureCode: string,
): Promise<{ terminal: boolean }> {
  const terminal = job.attemptCount >= job.maxAttempts;
  if (terminal) {
    await client`
      update report_jobs
      set status = 'failed', last_error = ${failureCode},
          locked_at = null, lock_expires_at = null
      where id = ${job.id}
    `;
    return { terminal: true };
  }
  const backoffSeconds = Math.min(2 ** job.attemptCount, BACKOFF_CAP_SECONDS);
  await client`
    update report_jobs
    set status = 'pending',
        available_at = now() + make_interval(secs => ${backoffSeconds}),
        locked_at = null,
        lock_expires_at = null,
        last_error = ${failureCode}
    where id = ${job.id}
  `;
  return { terminal: false };
}

export async function reenqueueReportJob(
  tx: DatabaseTransaction,
  reportId: string,
): Promise<boolean> {
  const rows = await tx`
    update report_jobs
    set status = 'pending', available_at = now(), attempt_count = 0,
        last_error = null, locked_at = null, lock_expires_at = null
    where report_id = ${reportId} and encrypted_source is not null
    returning id
  `;
  if (rows.length === 0) return false;
  await tx`update reports set status = 'pending', updated_at = now() where id = ${reportId}`;
  return true;
}

function json(value: unknown): DatabaseJsonValue {
  return JSON.parse(JSON.stringify(value)) as DatabaseJsonValue;
}

export async function writeReportResult(
  tx: DatabaseTransaction,
  input: {
    userId: string;
    reportId: string;
    sections: readonly StoredReportSection[];
  },
): Promise<void> {
  await tx`delete from report_sections where report_id = ${input.reportId} and user_id = ${input.userId}`;
  for (const section of input.sections)
    await tx`
      insert into report_sections (user_id, report_id, section_key, payload)
      values (
        ${input.userId}, ${input.reportId}, ${section.key},
        ${tx.json(
          json({
            title: section.title,
            body: section.body,
            ...(section.unavailable ? { unavailable: true } : {}),
          }),
        )}
      )
    `;
  await tx`
    update reports
    set status = 'ready', payload = ${tx.json(json({ sectionCount: input.sections.length }))},
        updated_at = now()
    where id = ${input.reportId} and user_id = ${input.userId}
  `;
}

export async function markReportGenerationFailed(
  tx: DatabaseTransaction,
  input: { userId: string; reportId: string },
): Promise<void> {
  await tx`
    update reports set status = 'failed', updated_at = now()
    where id = ${input.reportId} and user_id = ${input.userId}
  `;
}
