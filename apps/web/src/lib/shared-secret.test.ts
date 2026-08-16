import { describe, expect, it } from "vitest";

import { isWeakSharedSecret } from "./shared-secret";

const STRONG_SECRET = "k8mZ3q7wLxJb4hR9nP2sT6vY0cD5fG1e";

describe("isWeakSharedSecret", () => {
  it("accepts a long, high-entropy secret", () => {
    expect(isWeakSharedSecret(STRONG_SECRET)).toBe(false);
  });

  it("rejects a missing secret", () => {
    expect(isWeakSharedSecret(undefined)).toBe(true);
    expect(isWeakSharedSecret(null)).toBe(true);
    expect(isWeakSharedSecret("")).toBe(true);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(isWeakSharedSecret("a".repeat(31))).toBe(true);
  });

  it("rejects leading or trailing whitespace", () => {
    expect(isWeakSharedSecret(` ${STRONG_SECRET}`)).toBe(true);
    expect(isWeakSharedSecret(`${STRONG_SECRET} `)).toBe(true);
  });

  it("rejects a secret with fewer than 8 distinct characters", () => {
    expect(isWeakSharedSecret("ab".repeat(20))).toBe(true);
  });

  it("rejects a placeholder-like secret regardless of case", () => {
    expect(isWeakSharedSecret(`Change-Me-${"x".repeat(24)}`)).toBe(true);
    expect(isWeakSharedSecret(`EXAMPLE-${"y".repeat(26)}`)).toBe(true);
  });
});
