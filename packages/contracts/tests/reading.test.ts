import { describe, expect, it } from "vitest";

import { followUpResultSchema, normalizeFollowUpResult } from "../src";

describe("follow-up result contract", () => {
  it("accepts exactly one response section", () => {
    expect(followUpResultSchema.parse({ response: "A focused answer." })).toEqual({
      response: "A focused answer.",
    });
    expect(() => followUpResultSchema.parse({ response: "" })).toThrow();
    expect(() =>
      followUpResultSchema.parse({
        response: "A focused answer.",
        synthesis: "Not another reading.",
      }),
    ).toThrow();
  });

  it("normalizes legacy full-reading follow-ups into one response", () => {
    const normalized = normalizeFollowUpResult({
      title: "Legacy",
      directAnswer: "Direct answer.",
      centralTheme: "Theme.",
      cards: [
        {
          positionId: "focus",
          cardId: "major-00",
          orientation: "upright",
          traditionalMeaning: "Traditional.",
          personalizedMeaning: "Profile connection.",
          questionConnection: "Question connection.",
        },
      ],
      synthesis: "Synthesis.",
      likelyTrajectory: {
        summary: "Summary.",
        conditions: ["Condition."],
        alternateTrajectory: "Alternate.",
      },
      userAgency: ["Action."],
      reflectionQuestion: "Reflection?",
      disconfirmingEvidence: ["Evidence."],
      uncertainty: "Uncertainty.",
      safetyFlags: [],
    });
    expect(normalized).toEqual({
      response: "Direct answer. Profile connection. Synthesis. Action.",
    });
  });
});
