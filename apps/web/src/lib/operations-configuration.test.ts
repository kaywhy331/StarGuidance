import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const environmentExample = readFileSync(join(repositoryRoot, ".env.example"), "utf8");
const gitleaks = readFileSync(join(repositoryRoot, ".gitleaks.toml"), "utf8");
const ci = readFileSync(join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");
const stagingWorkflow = readFileSync(
  join(repositoryRoot, ".github", "workflows", "staging-verify.yml"),
  "utf8",
);

function declaredEnvironmentNames(): Set<string> {
  return new Set(
    environmentExample.split("\n").flatMap((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1] ?? []),
  );
}

describe("operator configuration contract", () => {
  it("documents the variables used by guarded database and trust-boundary tooling", () => {
    const declared = declaredEnvironmentNames();
    for (const name of [
      "DATABASE_INTEGRATION_URL",
      "READINESS_PROBE_SECRET",
      "TRUSTED_CLIENT_IP_HEADER",
      "KEY_ROTATION_MODE",
      "KEY_ROTATION_CONFIRM",
      "KEY_ROTATION_SYNTHETIC_ONLY",
      "KEY_ROTATION_REQUIRE_ROWS",
      "KEY_ROTATION_REQUIRE_CHANGES",
      "RETENTION_MODE",
      "RETENTION_DELETE_CONFIRM",
      "RETENTION_POLICY_VERSION",
      "RETENTION_AUDIT_BEFORE",
      "RETENTION_WEBHOOK_BEFORE",
      "RETENTION_FAILED_JOBS_BEFORE",
      "READING_ACCESS_MODE",
      "READING_FREE_ALLOWANCE",
      "READING_ALLOWANCE_WINDOW_HOURS",
      "READING_SESSION_TTL_MINUTES",
      "SUPPORT_USER_IDS",
      "OPERATOR_USER_IDS",
    ])
      expect(declared, `${name} must be present in .env.example`).toContain(name);

    for (const unused of [
      "NEXT_PUBLIC_APP_NAME",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "SENTRY_DSN",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "NEXT_PUBLIC_POSTHOG_HOST",
    ])
      expect(declared, `${unused} is not read and must not drift back in`).not.toContain(unused);
  });

  it("extends default secret rules with only exact synthetic markers", () => {
    expect(gitleaks).toMatch(/\[extend\][\s\S]*useDefault\s*=\s*true/);
    expect(gitleaks).not.toMatch(/paths\s*=/i);
    expect(gitleaks).toContain("readiness-probe-shared-secret");
    expect(ci).toContain("GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}");
  });

  it("keeps required PR contexts live without auto-running protected staging", () => {
    expect(ci).toMatch(/\n  guard:\n[\s\S]*\n  verify:\n/);
    expect(stagingWorkflow).toMatch(/on:\n  workflow_dispatch:/);
    expect(stagingWorkflow).not.toMatch(/on:\n[\s\S]{0,120}pull_request:/);
  });
});
