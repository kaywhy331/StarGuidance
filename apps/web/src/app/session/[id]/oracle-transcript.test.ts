import { describe, expect, it } from "vitest";

import {
  monotonicVisibleWordCount,
  narrationWordTokens,
  parseStreamLine,
  settledStreamState,
  streamFailureMessage,
} from "./oracle-transcript";

describe("reading transcript reveal progress", () => {
  it("never moves backward or past the available prose", () => {
    expect(monotonicVisibleWordCount(5, 2, 9)).toBe(5);
    expect(monotonicVisibleWordCount(5, 7, 9)).toBe(7);
    expect(monotonicVisibleWordCount(8, 12, 9)).toBe(9);
  });

  it("preserves prose spacing while splitting it into revealable words", () => {
    expect(narrationWordTokens("One calm, grounded step.")).toEqual([
      "One ",
      "calm, ",
      "grounded ",
      "step.",
    ]);
  });
});

describe("reading stream resilience", () => {
  it("skips malformed lines instead of surfacing parser messages", () => {
    expect(parseStreamLine("{not json")).toBe(undefined);
    expect(parseStreamLine(JSON.stringify({ type: "phase", sequence: -1 }))).toBe(undefined);
    expect(parseStreamLine(JSON.stringify({ type: "complete" }))).toEqual({ type: "complete" });
  });

  it("treats a stream that simply ended as complete only when passages arrived", () => {
    expect(settledStreamState(false, 3)).toBe("complete");
    expect(settledStreamState(false, 0)).toBe("failed");
    expect(settledStreamState(true, 0)).toBe("complete");
  });

  it("maps refusals to reader-facing copy", () => {
    expect(streamFailureMessage(409, "Turn over every card to open the whole reading.")).toBe(
      "Turn over every card to open the whole reading.",
    );
    expect(streamFailureMessage(409, { issues: [] })).toMatch(/isn’t ready/);
    expect(streamFailureMessage(502, "<html>")).not.toMatch(/html/);
    expect(streamFailureMessage(0)).toMatch(/connection/i);
  });
});
