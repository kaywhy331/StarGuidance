import { describe, expect, it } from "vitest";

import { truncateAtWord } from "./history-format";

describe("truncateAtWord", () => {
  it("keeps short text whole", () => {
    expect(truncateAtWord("Will the move go well?", 90)).toBe("Will the move go well?");
  });

  it("re-trims a preview that was cut mid-word upstream", () => {
    expect(
      truncateAtWord("How can I support my sister through her new job and the chan…", 90),
    ).toBe("How can I support my sister through her new job and the…");
  });

  it("cuts long text at the last whole word", () => {
    expect(truncateAtWord("one two three four five six", 14)).toBe("one two three…");
  });
});
