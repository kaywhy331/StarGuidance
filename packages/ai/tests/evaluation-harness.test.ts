import { expect, it, vi } from "vitest";
import {
  evaluatedSpreads,
  outputCases,
  questionCases,
  reflectionQuestions,
} from "../evaluation/corpus";
import { evaluateLocally } from "../evaluation/run-local";

it("isolates every provider call and retains negative findings without qualifying a provider", async () => {
  const realFetch = globalThis.fetch;
  const forbiddenNetwork = vi.fn(async () => {
    throw new Error("Network forbidden in local evaluation");
  });
  globalThis.fetch = forbiddenNetwork;
  try {
    const report = await evaluateLocally();
    expect(forbiddenNetwork).not.toHaveBeenCalled();
    expect(globalThis.fetch).toBe(forbiddenNetwork);
    expect(report.liveProviderCalls).toBe(0);
    expect(report.mockFetchCalls).toBeGreaterThan(0);
    expect(report.qualification).toContain("NOT_QUALIFIED");
    expect(report.rows).toHaveLength(
      questionCases.length +
        outputCases.length * 2 +
        evaluatedSpreads.length * reflectionQuestions.length +
        8,
    );
    expect(new Set(report.rows.map(({ id }) => id)).size).toBe(report.rows.length);
    expect(report.summary.passed + report.summary.failed).toBe(report.summary.total);
    // Positive and known-prohibited controls verify that the harness measures the
    // adapter decision. It does not assert that the entire candidate is safe.
    expect(report.rows.find(({ id }) => id === "O01-reading")?.passed).toBe(true);
    expect(report.rows.find(({ id }) => id === "O17-reading")?.passed).toBe(true);
    expect(report.rows.filter(({ id }) => id.startsWith("F")).every(({ passed }) => passed)).toBe(
      true,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
