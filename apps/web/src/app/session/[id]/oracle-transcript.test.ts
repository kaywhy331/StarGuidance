import { describe, expect, it } from "vitest";

import { isCardFocusedGuidedPassage } from "./oracle-transcript";

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
