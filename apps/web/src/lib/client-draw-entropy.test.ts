import { describe, expect, it } from "vitest";

import {
  createClientDrawNonce,
  isClientDrawNonce,
  stirClientDrawNonce,
} from "./client-draw-entropy";

const bytes = (value: number) => () => new Uint8Array(32).fill(value);

describe("client draw entropy", () => {
  it("creates the canonical 32-byte nonce required by the committed draw contract", () => {
    const zeroNonce = createClientDrawNonce(bytes(0));
    expect(zeroNonce).toBe("A".repeat(43));
    expect(createClientDrawNonce(bytes(255))).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(isClientDrawNonce(zeroNonce)).toBe(true);
    expect(isClientDrawNonce(`${zeroNonce.slice(0, -1)}B`)).toBe(false);
  });

  it("mixes every fresh stir contribution into the final nonce", () => {
    const initial = createClientDrawNonce(bytes(0));
    const stirred = stirClientDrawNonce(initial, bytes(0xa5));

    expect(stirred).not.toBe(initial);
    expect(stirClientDrawNonce(stirred, bytes(0xa5))).toBe(initial);
  });

  it("rejects malformed or incorrectly sized entropy", () => {
    expect(() => stirClientDrawNonce("not-a-nonce", bytes(1))).toThrow(/canonical base64url/);
    expect(() => createClientDrawNonce(() => new Uint8Array(31))).toThrow(/exactly 32 bytes/);
  });
});
