import { describe, expect, it } from "vitest";

import {
  GUEST_READING_CONTINUATION_PATH,
  safeAccountReturnPath,
  signInPathFor,
} from "./account-return";

describe("account return destinations", () => {
  it("allows the encrypted guest-reading continuation", () => {
    expect(safeAccountReturnPath(GUEST_READING_CONTINUATION_PATH)).toBe(
      GUEST_READING_CONTINUATION_PATH,
    );
    expect(safeAccountReturnPath([GUEST_READING_CONTINUATION_PATH, "https://evil.invalid"])).toBe(
      GUEST_READING_CONTINUATION_PATH,
    );
  });

  it("allows a well-formed sealed guest handoff in the fragment", () => {
    const token = `h1.${"a".repeat(16)}.${"B-_c".repeat(300)}.${"d".repeat(22)}`;
    const candidate = `/free-reading?continue=1#handoff=${token}`;
    expect(safeAccountReturnPath(candidate)).toBe(candidate);
  });

  it.each([
    "/free-reading?continue=1#handoff=x",
    `/free-reading?continue=1&handoff=h1.${"a".repeat(16)}.abc.${"d".repeat(22)}`,
    `/free-reading?continue=1#handoff=h1.${"a".repeat(16)}.abc.${"d".repeat(22)}#more`,
    `/free-reading?continue=1#handoff=h1.${"a".repeat(16)}.abc.${"d".repeat(22)}&next=//evil.invalid`,
    `/free-reading?continue=1#handoff=h1.${"a".repeat(16)}.${"b".repeat(6001)}.${"d".repeat(22)}`,
  ])("rejects a malformed guest handoff %#", (candidate) => {
    expect(safeAccountReturnPath(candidate)).toBeUndefined();
  });

  it.each([
    "/readings",
    "/reports",
    "/onboarding",
    "/history",
    "/profile",
    "/people",
    "/settings/account",
    "/settings/privacy",
    "/report/3f2a1c9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b",
    "/session/3f2a1c9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b",
    "/reading/3F2A1C9E-8B7D-4E6F-9A1B-2C3D4E5F6A7B",
  ])("allows the signed-in page %j a protected redirect started from", (candidate) => {
    expect(safeAccountReturnPath(candidate)).toBe(candidate);
  });

  it("builds a sign-in link that carries only allowed destinations", () => {
    expect(signInPathFor("/readings")).toBe("/sign-in?next=%2Freadings");
    expect(signInPathFor("/settings/account")).toBe("/sign-in?next=%2Fsettings%2Faccount");
    expect(signInPathFor("/settings")).toBe("/sign-in");
  });

  it.each([
    undefined,
    null,
    "",
    "/readings?x=1",
    "/readings/",
    "/settings",
    "/settings/account/",
    "/report/not-a-uuid",
    "/session/not-a-uuid",
    "/session/3f2a1c9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b/extra",
    "/reading/3f2a1c9e-8b7d-4e6f-9a1b-2c3d4e5f6a7b?next=//evil.invalid",
    "//evil.invalid",
    "https://evil.invalid/free-reading?continue=1",
    "/free-reading?continue=1&next=https://evil.invalid",
    "/free-reading%3Fcontinue=1",
    "/\\evil.invalid/free-reading?continue=1",
  ])("rejects unsupported or external destination %j", (candidate) => {
    expect(safeAccountReturnPath(candidate)).toBeUndefined();
  });
});
