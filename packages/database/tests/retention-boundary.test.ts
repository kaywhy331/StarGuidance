import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const script = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "apply-retention.ts"),
  "utf8",
);

describe("retention automation boundary", () => {
  it("can delete only approved operational classes", () => {
    const deletedTables = [...script.matchAll(/delete\s+from\s+([a-z_]+)/gi)].map(
      ([, table]) => table,
    );
    expect(new Set(deletedTables)).toEqual(
      new Set([
        "audit_events",
        "payment_webhook_events",
        "interpretation_jobs",
        "rate_limit_buckets",
      ]),
    );
    for (const privateTable of [
      "birth_profiles",
      "profile_snapshots",
      "reading_sessions",
      "reading_draws",
      "reports",
      "orders",
      "entitlements",
    ])
      expect(script).not.toMatch(new RegExp(`delete\\s+from\\s+${privateTable}`, "i"));
  });

  it("defaults to inventory and requires an explicit deletion confirmation", () => {
    expect(script).toContain('process.env.RETENTION_MODE ?? "inventory"');
    expect(script).toContain("DELETE_BEFORE_APPROVED_CUTOFFS");
    expect(script).toContain("processed_at is not null");
  });

  it("deletes only terminally failed jobs and only expired buckets", () => {
    // Pending/processing jobs and live buckets must be untouchable: the job
    // delete is pinned to status='failed' with a cutoff, the bucket delete to
    // rows past their own expires_at.
    expect(script).toMatch(
      /delete\s+from\s+interpretation_jobs\s+where\s+status\s*=\s*'failed'\s+and\s+created_at\s*</,
    );
    expect(script).toMatch(/delete\s+from\s+rate_limit_buckets\s+where\s+expires_at\s*<\s*now\(\)/);
  });
});
