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
  const sql = createDatabaseClient(required("DATABASE_URL"));
  try {
    const inventoryQuery = async (query: typeof sql) => {
      const [inventory] = await query<{ audit_count: number; webhook_count: number }[]>`
      select
        (select count(*)::integer from audit_events where created_at < ${auditBefore})
          as audit_count,
        (select count(*)::integer from payment_webhook_events
          where processed_at is not null and processed_at < ${webhookBefore})
          as webhook_count`;
      return {
        audit: inventory?.audit_count ?? 0,
        webhooks: inventory?.webhook_count ?? 0,
      };
    };
    if (retentionMode === "inventory") {
      const inventory = await inventoryQuery(sql);
      process.stdout.write(
        `Retention ${policyVersion}: ${inventory.audit} audit and ${inventory.webhooks} completed webhook row(s) eligible.\n`,
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
      if (audit.length !== inventory.audit || webhooks.length !== inventory.webhooks)
        throw new Error("Retention inventory changed during the guarded deletion transaction");
      return { audit: audit.length, webhooks: webhooks.length };
    });
    process.stdout.write(
      `Retention ${policyVersion}: deleted ${deleted.audit} audit and ${deleted.webhooks} completed webhook row(s).\n`,
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

await main();
