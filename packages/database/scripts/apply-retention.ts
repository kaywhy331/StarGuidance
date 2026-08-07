import { createDatabaseClient } from "../src/postgres-client";

type RetentionMode = "inventory" | "delete";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cutoff(name: string): string {
  const value = required(name);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value)
    throw new Error(`${name} must be an exact UTC ISO timestamp`);
  if (parsed.valueOf() >= Date.now()) throw new Error(`${name} must be in the past`);
  return value;
}

function mode(): RetentionMode {
  const value = process.env.RETENTION_MODE ?? "inventory";
  if (value !== "inventory" && value !== "delete")
    throw new Error("RETENTION_MODE must be inventory or delete");
  if (
    value === "delete" &&
    process.env.RETENTION_DELETE_CONFIRM !== "DELETE_BEFORE_APPROVED_CUTOFFS"
  )
    throw new Error("Deletion requires RETENTION_DELETE_CONFIRM=DELETE_BEFORE_APPROVED_CUTOFFS");
  return value;
}

async function main(): Promise<void> {
  const retentionMode = mode();
  const policyVersion = required("RETENTION_POLICY_VERSION");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(policyVersion))
    throw new Error("RETENTION_POLICY_VERSION must be a short non-sensitive identifier");
  const auditBefore = cutoff("RETENTION_AUDIT_BEFORE");
  const webhookBefore = cutoff("RETENTION_WEBHOOK_BEFORE");
  // Terminally failed interpretation jobs are the queue's dead-letter record
  // (nothing else surfaces status='failed'), so they leave only through this
  // guarded command with an explicit approved cutoff — completed jobs and
  // expired rate-limit buckets are already pruned opportunistically by the
  // scheduled drain (pruneExpiredSystemRows); the bucket class here exists so
  // an operator can clear backlog accumulated while the drain was down.
  const failedJobsBefore = cutoff("RETENTION_FAILED_JOBS_BEFORE");
  const sql = createDatabaseClient(required("DATABASE_URL"));
  try {
    const inventoryQuery = async (query: typeof sql) => {
      const [inventory] = await query<
        {
          audit_count: number;
          webhook_count: number;
          failed_jobs_count: number;
          expired_buckets_count: number;
        }[]
      >`
      select
        (select count(*)::integer from audit_events where created_at < ${auditBefore})
          as audit_count,
        (select count(*)::integer from payment_webhook_events
          where processed_at is not null and processed_at < ${webhookBefore})
          as webhook_count,
        (select count(*)::integer from interpretation_jobs
          where status = 'failed' and created_at < ${failedJobsBefore})
          as failed_jobs_count,
        (select count(*)::integer from rate_limit_buckets where expires_at < now())
          as expired_buckets_count`;
      return {
        audit: inventory?.audit_count ?? 0,
        webhooks: inventory?.webhook_count ?? 0,
        failedJobs: inventory?.failed_jobs_count ?? 0,
        expiredBuckets: inventory?.expired_buckets_count ?? 0,
      };
    };
    if (retentionMode === "inventory") {
      const inventory = await inventoryQuery(sql);
      process.stdout.write(
        `Retention ${policyVersion}: ${inventory.audit} audit, ${inventory.webhooks} completed webhook, ` +
          `${inventory.failedJobs} failed interpretation-job, and ${inventory.expiredBuckets} expired rate-limit row(s) eligible.\n`,
      );
      return;
    }

    const deleted = await sql.begin(async (tx) => {
      const inventory = await inventoryQuery(tx as typeof sql);
      const audit = await tx`
        delete from audit_events where created_at < ${auditBefore} returning id`;
      const webhooks = await tx`
        delete from payment_webhook_events
        where processed_at is not null and processed_at < ${webhookBefore} returning id`;
      const failedJobs = await tx`
        delete from interpretation_jobs
        where status = 'failed' and created_at < ${failedJobsBefore} returning id`;
      const expiredBuckets = await tx`
        delete from rate_limit_buckets where expires_at < now() returning key_hash`;
      if (
        audit.length !== inventory.audit ||
        webhooks.length !== inventory.webhooks ||
        failedJobs.length !== inventory.failedJobs ||
        expiredBuckets.length !== inventory.expiredBuckets
      )
        throw new Error("Retention inventory changed during the guarded deletion transaction");
      return {
        audit: audit.length,
        webhooks: webhooks.length,
        failedJobs: failedJobs.length,
        expiredBuckets: expiredBuckets.length,
      };
    });
    process.stdout.write(
      `Retention ${policyVersion}: deleted ${deleted.audit} audit, ${deleted.webhooks} completed webhook, ` +
        `${deleted.failedJobs} failed interpretation-job, and ${deleted.expiredBuckets} expired rate-limit row(s).\n`,
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

await main();
