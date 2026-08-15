import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildJobQueueDiagnostics } from "./job-diagnostics";

describe("redacted job diagnostics", () => {
  it("renders only aggregate statuses and fixed failure classes", () => {
    const diagnostics = buildJobQueueDiagnostics([
      { queue: "interpretation", status: "pending", failure_class: null, count: 3 },
      { queue: "interpretation", status: "failed", failure_class: null, count: 2 },
      {
        queue: "interpretation",
        status: "failed",
        failure_class: "interpretation_generation_failed",
        count: 2,
      },
      { queue: "report", status: "processing", failure_class: null, count: 1 },
      {
        queue: "report",
        status: "failed",
        failure_class: "report_unclassified",
        count: 1,
      },
    ]);

    expect(diagnostics).toEqual({
      interpretation: {
        statuses: { pending: 3, failed: 2 },
        failedByClass: { interpretation_generation_failed: 2 },
      },
      report: {
        statuses: { processing: 1 },
        failedByClass: { report_unclassified: 1 },
      },
    });
    expect(JSON.stringify(diagnostics)).not.toMatch(/question|source|userId|last_error/i);
  });

  it("keeps the operator entrypoint read-only and aggregate-only", () => {
    const root = dirname(fileURLToPath(import.meta.url));
    const implementation = readFileSync(join(root, "job-diagnostics.ts"), "utf8");
    const entrypoint = readFileSync(join(root, "..", "scripts", "inspect-job-queues.ts"), "utf8");

    expect(`${implementation}\n${entrypoint}`).not.toMatch(/\b(?:insert|update|delete)\s+/i);
    expect(implementation).not.toMatch(/select\s+[^;]*\blast_error\s*(?:,|from)/i);
    expect(entrypoint).not.toMatch(/user|question|encrypted|last_error/i);
  });
});
