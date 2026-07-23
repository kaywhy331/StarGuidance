import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSensitive, encryptSensitive } from "../src";

describe("authenticated sensitive-field encryption", () => {
  const key = randomBytes(32).toString("base64");
  it("round trips without exposing plaintext", () => {
    const encrypted = encryptSensitive("private birth details", key);
    expect(encrypted).not.toContain("private birth details");
    expect(decryptSensitive(encrypted, key)).toBe("private birth details");
  });
  it("rejects tampering", () => {
    const encrypted = encryptSensitive("private question", key);
    const parts = encrypted.split(".");
    const tag = parts[2] as string;
    parts[2] = `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`;
    const tampered = parts.join(".");
    expect(() => decryptSensitive(tampered, key)).toThrow();
  });
});
