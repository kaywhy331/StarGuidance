import { describe, expect, it } from "vitest";

import { isCardFocusedGuidedPassage, passagePresentation } from "./oracle-transcript";

describe("guided reading card focus", () => {
  it.each(["situation", "underlyingPattern", "development"] as const)(
    "keeps %s attached to its referenced card",
    (role) => expect(isCardFocusedGuidedPassage(role)).toBe(true),
  );

  it.each([
    "opening",
    "turningPoint",
    "trajectory",
    "alternative",
    "agency",
    "reflection",
    "closing",
    "safety",
  ] as const)("returns %s to the full spread", (role) =>
    expect(isCardFocusedGuidedPassage(role)).toBe(false),
  );
});

describe("complete reading passage labels", () => {
  const emperor = {
    name: "The Emperor",
    orientation: "reversed" as const,
    positionName: "Future · Integration",
  };

  it("uses the spread position and card for a card-focused passage", () => {
    expect(passagePresentation("development", [emperor])).toEqual({
      label: "Future · Integration",
      detail: "The Emperor · Reversed",
    });
  });

  it.each([
    ["turningPoint", "Turning point"],
    ["trajectory", "Likely trajectory"],
    ["alternative", "Alternative path"],
    ["agency", "Your agency"],
  ] as const)("does not repeat a referenced card under %s", (role, label) => {
    expect(passagePresentation(role, [emperor])).toEqual({ label });
  });
});
