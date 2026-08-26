import { describe, expect, it } from "vitest";

import { monotonicVisibleWordCount, narrationWordTokens } from "./oracle-transcript";

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
