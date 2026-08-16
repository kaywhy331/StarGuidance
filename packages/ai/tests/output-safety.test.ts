import { describe, expect, it } from "vitest";

import { generatedOutputSafetyViolation } from "../src/output-safety";

describe("generated profile-value guard", () => {
  it.each([
    "Your Life Path 7 means you must act now.",
    "Your Ascendant is Leo, so this card confirms visibility.",
    "You are a Scorpio rising and should trust the prediction.",
    "Your Dreamspell Kin is 34.",
    "Your BaZi day pillar is Jia Zi.",
    "Your Principal Nine Star Ki star is 4.",
  ])("rejects unsupported profile claim: %s", (text) => {
    expect(generatedOutputSafetyViolation({ synthesis: text })).toBe("invented-profile-value");
  });

  it("does not confuse traditional tarot-card language with a natal claim", () => {
    expect(
      generatedOutputSafetyViolation({
        traditionalMeaning: "The Moon card can reflect uncertainty and incomplete information.",
        personalizedMeaning: "Notice what evidence would help you feel grounded.",
      }),
    ).toBeUndefined();
  });
});
