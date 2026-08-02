import { describe, expect, it } from "vitest";

import { evaluateGate, REQUIRED_STAGES, type GateInput } from "./staging-gate";
import type { StagingResult } from "./staging-result";

const ALL_STAGES = [...REQUIRED_STAGES];

function result(status: StagingResult["status"], check = "example check"): StagingResult {
  return { section: "Example", check, status, detail: "synthetic" };
}

function gate(overrides: Partial<GateInput> = {}) {
  return evaluateGate({
    results: [],
    completedStages: ALL_STAGES,
    successMarker: true,
    ...overrides,
  });
}

describe("staging verification gate", () => {
  it("passes only when every stage completed, the marker exists, and nothing failed", () => {
    const verdict = gate({ results: [result("pass"), result("limited")] });
    expect(verdict.status).toBe("passed");
    expect(verdict.reasons).toEqual([]);
  });

  it("reports NOT RUN when a missing secret stops the job before any stage", () => {
    // The configuration step must append a failure row, but even if the job dies
    // before recording anything, an empty result set can never read as passed.
    const verdict = gate({ results: [], completedStages: [], successMarker: false });
    expect(verdict.status).toBe("not-run");
    expect(verdict.status).not.toBe("passed");
  });

  it("fails when a missing secret was recorded as a failure", () => {
    const verdict = gate({
      results: [result("fail", "Required configuration present")],
      completedStages: [],
      successMarker: false,
    });
    expect(verdict.status).toBe("failed");
    expect(verdict.reasons.some((reason) => reason.includes("Required configuration"))).toBe(true);
  });

  it("fails when a missing non-secret variable was recorded as a failure", () => {
    const verdict = gate({
      results: [result("fail", "Required configuration present")],
      completedStages: ["configuration"],
      successMarker: false,
    });
    expect(verdict.status).toBe("failed");
  });

  it("fails when migrations failed and the rest of the pipeline was skipped", () => {
    const verdict = gate({
      results: [result("fail", "Apply migrations")],
      completedStages: ["configuration"],
      successMarker: false,
    });
    expect(verdict.status).toBe("failed");
    expect(verdict.failureCount).toBe(1);
    expect(verdict.missingStages).toContain("migrations");
  });

  it("fails when substantive steps were skipped even though nothing recorded a failure", () => {
    // This is the regression that allowed a skipped run to report PASSED: the
    // only recorded rows were the hosted log review, which never fails.
    const verdict = gate({
      results: [
        result("pass", "Application health endpoint exposes no values"),
        result("limited", "Netlify, Supabase and Render log inspection"),
      ],
      completedStages: ["configuration"],
      successMarker: false,
    });
    expect(verdict.status).toBe("failed");
    expect(verdict.failureCount).toBe(0);
    expect(verdict.reasons.some((reason) => reason.includes("success marker"))).toBe(true);
  });

  it("never lets the hosted-log-review limitation decide the outcome", () => {
    const limitedOnly = gate({ results: [result("limited")] });
    expect(limitedOnly.status).toBe("passed");
    const limitedButIncomplete = gate({
      results: [result("limited")],
      completedStages: ALL_STAGES.filter((stage) => stage !== "browser-verification"),
      successMarker: false,
    });
    expect(limitedButIncomplete.status).toBe("failed");
  });

  it("fails when cleanup did not run successfully", () => {
    const verdict = gate({
      completedStages: ALL_STAGES.filter((stage) => stage !== "cleanup"),
    });
    expect(verdict.status).toBe("failed");
    expect(verdict.missingStages).toEqual(["cleanup"]);
  });

  it("fails when the success marker is absent despite every stage marker existing", () => {
    const verdict = gate({ successMarker: false });
    expect(verdict.status).toBe("failed");
  });

  it.each(ALL_STAGES)("fails when the %s stage is missing", (stage) => {
    const verdict = gate({ completedStages: ALL_STAGES.filter((name) => name !== stage) });
    expect(verdict.status).toBe("failed");
    expect(verdict.missingStages).toContain(stage);
  });
});
