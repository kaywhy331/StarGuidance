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
    expect(new Set(deletedTables)).toEqual(new Set(["audit_events", "payment_webhook_events"]));
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
});
