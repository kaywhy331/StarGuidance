import type { StagingResult } from "./staging-result";

/**
 * Decides whether a staging verification run may be reported as passed.
 *
 * The gate is deliberately positive-evidence driven: an empty or partial result
 * set is never a pass. Every mandatory stage must have left a completion marker,
 * the end-of-pipeline success marker must exist, and no recorded result may be a
 * failure. A run that stopped early therefore reports NOT RUN or FAILED, never
 * PASSED.
 */
export type GateStatus = "passed" | "failed" | "not-run";

/**
 * Stages that must all have run for a verification to mean anything.
 *
 * Workflow steps mark their own stage through `.github/scripts/stage.sh`; the
 * stages that live inside a suite mark themselves through `completeStage()`.
 * Either way an unreached stage leaves no marker, so a partial run reports
 * FAILED or NOT RUN rather than PASSED.
 */
export const REQUIRED_STAGES = [
  // Configuration and database readiness
  "configuration",
  "database-preflight",
  "migration-history",
  "migrations",
  // Migration 0002 and the protections it had to preserve
  "sync-trigger-absent",
  "forced-rls",
  // Reference data
  "seed-first",
  "fingerprint-capture",
  "seed-second",
  "fingerprint-compare",
  // Database-level isolation
  "rls-suite",
  "report-fulfillment",
  // Deployed services
  "preview-provenance",
  "profile-engine-probe",
  "netlify-preview-probe",
  // Identity and provisioning after the trigger was removed
  "auth-identity-creation",
  "app-provisioning",
  // Application behaviour on the deploy preview
  "profile-onboarding",
  "profile-lineage",
  "reading-creation",
  "draw-equality",
  "cross-user-denial",
  "export-isolation",
  "account-deletion",
  "accessibility",
  "guest-trial",
  // Credentialed database-side rotation and guaranteed restoration before teardown
  "key-rotation-forward",
  "key-rotation-rollback",
  // Reporting and teardown
  "cleanup",
  "summary",
] as const;

export type RequiredStage = (typeof REQUIRED_STAGES)[number];

/** Created only after every mandatory verification stage has succeeded. */
export const SUCCESS_MARKER = "all-mandatory-complete";

export interface GateInput {
  readonly results: readonly StagingResult[];
  readonly completedStages: readonly string[];
  readonly successMarker: boolean;
}

export interface GateVerdict {
  readonly status: GateStatus;
  readonly reasons: readonly string[];
  readonly missingStages: readonly RequiredStage[];
  readonly failureCount: number;
}

export function evaluateGate(input: GateInput): GateVerdict {
  const completed = new Set(input.completedStages);
  const missingStages = REQUIRED_STAGES.filter((stage) => !completed.has(stage));
  const failures = input.results.filter(({ status }) => status === "fail");
  const reasons: string[] = [];

  for (const failure of failures) reasons.push(`recorded failure: ${failure.check}`);
  if (!input.successMarker) reasons.push("the end-of-pipeline success marker was never created");
  if (missingStages.length > 0)
    reasons.push(`mandatory stage(s) did not complete: ${missingStages.join(", ")}`);

  if (reasons.length === 0)
    return { status: "passed", reasons: [], missingStages: [], failureCount: 0 };

  // Nothing substantive happened at all: report that rather than implying the
  // verification ran and found problems.
  const status: GateStatus =
    failures.length === 0 && missingStages.length === REQUIRED_STAGES.length ? "not-run" : "failed";

  return { status, reasons, missingStages, failureCount: failures.length };
}
