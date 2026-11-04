import "server-only";

import {
  actorTransaction,
  claimReportJobs,
  completeReportJob,
  failReportJob,
  markReportGenerationFailed,
  writeReportResult,
  type ClaimedReportJob,
  type DatabaseClient,
} from "@starguidance/database";

import { recordAudit } from "./persistence";
import { tryRecordProductEvent } from "./product-telemetry";
import { buildProfileReportSections, readProfileReportSource } from "./report";
import { getRuntimeAdapter, getSystemDatabaseClient } from "./runtime";

export interface ReportJobsRunSummary {
  claimed: number;
  succeeded: number;
  failed: number;
}

function failureCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("authenticate")) return "report_source_authentication_failed";
    if (error.name === "ZodError" || error instanceof SyntaxError) return "report_source_invalid";
  }
  return "report_generation_failed";
}

async function processJob(sql: DatabaseClient, job: ClaimedReportJob): Promise<boolean> {
  if (job.attemptCount > 1)
    await tryRecordProductEvent({
      idempotencyKey: `report-job:${job.id}:attempt:${job.attemptCount}`,
      name: "job_retried",
      properties: { statusClass: "started" },
    });
  try {
    const source = readProfileReportSource({
      userId: job.userId,
      encryptedSource: job.encryptedSource,
    });
    const sections = buildProfileReportSections(source);
    await actorTransaction(sql, job.userId, (tx) =>
      writeReportResult(tx, {
        userId: job.userId,
        reportId: job.reportId,
        sections,
      }),
    );
    await recordAudit(job.userId, "report.generated", "report", job.reportId);
    await completeReportJob(sql, job.id);
    await tryRecordProductEvent({
      idempotencyKey: `report:${job.reportId}:ready`,
      name: "report_ready",
      properties: {
        productId: "profile-report-v1",
        provider: "stripe",
        statusClass: "ready",
      },
    });
    return true;
  } catch (error) {
    const { terminal } = await failReportJob(sql, job, failureCode(error));
    if (terminal)
      await actorTransaction(sql, job.userId, (tx) =>
        markReportGenerationFailed(tx, { userId: job.userId, reportId: job.reportId }),
      );
    return false;
  }
}

export async function runReportJobs(limit: number): Promise<ReportJobsRunSummary> {
  if (getRuntimeAdapter() !== "supabase") return { claimed: 0, succeeded: 0, failed: 0 };
  const sql = getSystemDatabaseClient();
  const claimed = await claimReportJobs(sql, limit);
  let succeeded = 0;
  let failed = 0;
  for (const job of claimed) {
    if (await processJob(sql, job)) succeeded += 1;
    else failed += 1;
  }
  return { claimed: claimed.length, succeeded, failed };
}
