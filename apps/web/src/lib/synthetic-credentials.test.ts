import { describe, expect, it } from "vitest";

import {
  MAX_PROVIDER_PASSWORD_BYTES,
  syntheticPassword,
} from "../../tests/staging/synthetic-credentials";

/**
 * The deployed staging harness creates its identities through the same Admin
 * API as the database suites, so it is subject to the same provider limit. A
 * password over 72 bytes is refused with an opaque HTTP 500 that reads as a
 * database fault, so the limit is asserted here rather than discovered again.
 */
describe("synthetic staging credentials", () => {
  it("stays inside the provider's bcrypt password limit", () => {
    expect(MAX_PROVIDER_PASSWORD_BYTES).toBe(72);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(Buffer.byteLength(syntheticPassword(), "utf8")).toBeLessThanOrEqual(
        MAX_PROVIDER_PASSWORD_BYTES,
      );
    }
  });

  it("generates a distinct, unguessable password each time", () => {
    const passwords = new Set(Array.from({ length: 50 }, () => syntheticPassword()));
    expect(passwords.size).toBe(50);
    for (const password of passwords) expect(password.length).toBeGreaterThan(20);
  });
});
