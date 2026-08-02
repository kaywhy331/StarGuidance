import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared recorder for the credential-gated staging verification workflow.
 *
 * Every entry is appended as one JSON line to the file named by STAGING_RESULTS.
 * Only non-secret status text may be recorded: the rendered summary is uploaded
 * as a workflow artifact and copied into a public pull request.
 */
export type StagingStatus = "pass" | "fail" | "skipped" | "limited";

export interface StagingResult {
  readonly section: string;
  readonly check: string;
  readonly status: StagingStatus;
  readonly detail: string;
}

/** Values that must never reach the summary even by accident. */
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /postgres(ql)?:\/\/\S+/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bsb[ph]?_[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+\S+/gi,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // Driver and fetch errors quote the host they failed to reach, which would
  // carry a project reference into published evidence.
  /\b[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+\.[A-Za-z]{2,}\b/g,
];

export function redact(value: string): string {
  return FORBIDDEN_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    value,
  ).slice(0, 300);
}

export function record(result: StagingResult): void {
  const target = process.env.STAGING_RESULTS;
  if (!target) throw new Error("STAGING_RESULTS must name the results file");
  appendFileSync(
    target,
    `${JSON.stringify({ ...result, detail: redact(result.detail) })}\n`,
    "utf8",
  );
}

/**
 * Marks one mandatory verification stage as having completed successfully.
 *
 * The gate is positive-evidence driven, so a stage that never calls this is
 * treated as not run and the whole verification cannot report PASSED. Stages
 * that live inside a suite rather than inside a workflow step mark themselves
 * here, which is why a suite that crashes half way through still leaves the
 * stages it never reached unmarked.
 *
 * A no-op outside the workflow, so the suites remain runnable locally.
 */
export function completeStage(stage: string): void {
  const dir = process.env.STAGE_DIR;
  if (!dir) return;
  if (!/^[a-z0-9-]+$/.test(stage)) throw new Error(`invalid stage name: ${stage}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, stage), "", "utf8");
}

/** Reads a required configuration value without ever echoing it. */
export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required but was not provided to this step`);
  return value;
}
