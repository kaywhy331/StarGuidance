import { describe, expect, it } from "vitest";

import { followUpsRemainingCopy } from "./reading-closure";
import { keepsakeSectionsFrom } from "./reading-keepsake";

describe("reading keepsake", () => {
  it("lists whole-reading sections in order and leaves out unsupported ones", () => {
    const sections = keepsakeSectionsFrom({
      schemaVersion: "reading-result-v3",
      directAnswer: "A",
      overallPattern: "B",
      cards: [],
      synthesis: "C",
      likelyTrajectory: null,
      alternatePath: "D",
      timing: null,
      userAgency: "E",
      reflectionPrompt: "F",
      uncertaintyNote: "G",
      personalizationLens: null,
      safetyFlags: [],
    } as unknown as Parameters<typeof keepsakeSectionsFrom>[0]);
    expect(sections.map(({ heading }) => heading)).toEqual([
      "Your answer",
      "The thread through your cards",
      "How the cards speak together",
      "Another way it could go",
      "Your move",
      "A question to carry",
      "What the cards can’t know",
    ]);
  });

  it("pluralizes the follow-up count", () => {
    expect(followUpsRemainingCopy(1)).toBe("1 private follow-up remains with this draw.");
    expect(followUpsRemainingCopy(2)).toBe("2 private follow-ups remain with this draw.");
  });
});
