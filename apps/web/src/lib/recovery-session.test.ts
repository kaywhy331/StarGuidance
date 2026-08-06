import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { issueRecoveryReceipt, verifyRecoveryReceipt } from "./recovery-session";

const userId = "4978a7ef-c4a6-462d-befe-d286a38a772f";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
});

afterEach(() => vi.unstubAllEnvs());

describe("password-recovery receipt", () => {
  it("binds a short-lived authenticated receipt to one user", () => {
    const now = Date.parse("2026-08-05T00:00:00.000Z");
    const receipt = issueRecoveryReceipt(userId, now);

    expect(verifyRecoveryReceipt(receipt, userId, now + 14 * 60 * 1000)).toBe(true);
    expect(verifyRecoveryReceipt(receipt, "00000000-0000-4000-8000-000000000001", now)).toBe(false);
    expect(verifyRecoveryReceipt(receipt, userId, now + 16 * 60 * 1000)).toBe(false);
    expect(verifyRecoveryReceipt(`${receipt}tampered`, userId, now)).toBe(false);
  });
});
