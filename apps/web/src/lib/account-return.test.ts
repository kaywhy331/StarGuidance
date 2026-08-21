import { describe, expect, it } from "vitest";

import { GUEST_READING_CONTINUATION_PATH, safeAccountReturnPath } from "./account-return";

describe("account return destinations", () => {
  it("allows the encrypted guest-reading continuation", () => {
    expect(safeAccountReturnPath(GUEST_READING_CONTINUATION_PATH)).toBe(
      GUEST_READING_CONTINUATION_PATH,
    );
    expect(safeAccountReturnPath([GUEST_READING_CONTINUATION_PATH, "https://evil.invalid"])).toBe(
      GUEST_READING_CONTINUATION_PATH,
    );
  });

  it.each([
    undefined,
    null,
    "",
    "/readings",
    "//evil.invalid",
    "https://evil.invalid/free-reading?continue=1",
    "/free-reading?continue=1&next=https://evil.invalid",
    "/free-reading%3Fcontinue=1",
    "/\\evil.invalid/free-reading?continue=1",
  ])("rejects unsupported or external destination %j", (candidate) => {
    expect(safeAccountReturnPath(candidate)).toBeUndefined();
  });
});
