import { createCipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptSensitive,
  decryptSensitiveWithKeys,
  encryptSensitive,
  isLegacyEnvelope,
  isValidEncryptionKey,
} from "../src";

describe("authenticated sensitive-field encryption", () => {
  const key = randomBytes(32).toString("base64");
  const context = "reading-question:4978a7ef-c4a6-462d-befe-d286a38a772f";

  it("round trips without exposing plaintext", () => {
    const encrypted = encryptSensitive("private birth details", key, context);
    expect(encrypted).not.toContain("private birth details");
    expect(encrypted.startsWith("2.")).toBe(true);
    expect(isLegacyEnvelope(encrypted)).toBe(false);
    expect(decryptSensitive(encrypted, key, context)).toBe("private birth details");
  });

  it("rejects tampering", () => {
    const encrypted = encryptSensitive("private question", key, context);
    const parts = encrypted.split(".");
    const tag = parts[2] as string;
    parts[2] = `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`;
    const tampered = parts.join(".");
    expect(() => decryptSensitive(tampered, key, context)).toThrow();
  });

  it("binds the envelope to its context: another user or class cannot decrypt it", () => {
    const encrypted = encryptSensitive("private question", key, context);
    expect(() =>
      decryptSensitive(encrypted, key, "reading-question:b6a1a6b0-9f8b-4b6a-9f0b-0f2b8b8f9a11"),
    ).toThrow();
    expect(() =>
      decryptSensitive(encrypted, key, "profile-input:4978a7ef-c4a6-462d-befe-d286a38a772f"),
    ).toThrow();
    expect(() => decryptSensitiveWithKeys(encrypted, [key], "profile-input:someone-else")).toThrow(
      /authenticated/,
    );
  });

  it("refuses to encrypt without a context", () => {
    expect(() => encryptSensitive("private question", key, "")).toThrow(/context/i);
  });

  it("still reads a legacy v1 envelope under any declared context until rotation rebinds it", () => {
    // Hand-built v1 envelope: same construction the pre-AAD implementation
    // used, so real legacy rows keep decrypting while rotation migrates them.
    const legacy = buildLegacyEnvelope("legacy plaintext", key);
    expect(isLegacyEnvelope(legacy)).toBe(true);
    expect(decryptSensitive(legacy, key, context)).toBe("legacy plaintext");
    expect(decryptSensitive(legacy, key, "profile-input:someone-else")).toBe("legacy plaintext");
  });

  it("reads an old envelope during a bounded rotation window", () => {
    const previous = randomBytes(32).toString("base64");
    const current = randomBytes(32).toString("base64");
    const encrypted = encryptSensitive("rotation fixture", previous, context);
    expect(decryptSensitiveWithKeys(encrypted, [current, previous], context)).toBe(
      "rotation fixture",
    );
    expect(() => decryptSensitiveWithKeys(encrypted, [current], context)).toThrow(/authenticated/);
  });

  it("rejects malformed, padded, and non-canonical managed keys", () => {
    expect(isValidEncryptionKey(key)).toBe(true);
    expect(isValidEncryptionKey(` ${key}`)).toBe(false);
    expect(isValidEncryptionKey(Buffer.alloc(31).toString("base64"))).toBe(false);
    expect(isValidEncryptionKey("!".repeat(44))).toBe(false);
  });
});

function buildLegacyEnvelope(plaintext: string, base64Key: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(base64Key, "base64"), nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    1,
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}
