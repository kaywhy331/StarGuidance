import { describe, expect, it } from "vitest";

import { classifyQuestionContext, recommendSpreadId } from "../src";

const allSpreads = [
  "one-card",
  "three-card",
  "crossroads",
  "outlook",
  "celtic-cross",
  "horseshoe",
  "relationship",
  "nine-card-matrix",
] as const;

function route(question: string) {
  return recommendSpreadId({
    question,
    classification: classifyQuestionContext(question),
    availableSpreadIds: allSpreads,
  });
}

describe("automatic spread selection", () => {
  it("uses the two-party structure for relationship questions and @mentions", () => {
    expect(route("Why has @john-smith been so distant in our relationship? ")).toBe("relationship");
    expect(route("How can I communicate with my partner more honestly?")).toBe("relationship");
  });

  it("uses Crossroads for a choice and Horseshoe for a plan", () => {
    expect(route("Should I leave this role or accept the new offer?")).toBe("crossroads");
    expect(route("How should I plan my next career move?")).toBe("horseshoe");
  });

  it("keeps an immediate narrow question concise", () => {
    expect(route("What should I notice today?")).toBe("one-card");
  });

  it("falls back only to an enabled spread", () => {
    const question = "What is happening in my relationship?";
    expect(
      recommendSpreadId({
        question,
        classification: classifyQuestionContext(question),
        availableSpreadIds: ["three-card"],
      }),
    ).toBe("three-card");
  });
});
