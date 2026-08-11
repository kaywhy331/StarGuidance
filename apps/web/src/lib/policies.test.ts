import { describe, expect, it } from "vitest";

import {
  hasCurrentMarketingConsent,
  hasCurrentRequiredPolicyConsents,
  POLICY_CONSENT_METADATA_KEY,
  POLICY_VERSIONS,
  policyConsentReceiptsFromMetadata,
  signupConsentReceipts,
} from "./policies";

describe("versioned policy consent", () => {
  it("requires every current service-policy version and ignores optional marketing", () => {
    const current = signupConsentReceipts("2026-08-10T00:00:00.000Z").map((receipt) => ({
      policy: receipt.policy,
      version: receipt.version,
      grantedAt: receipt.acceptedAt,
    }));

    expect(hasCurrentRequiredPolicyConsents(current)).toBe(true);
    expect(hasCurrentMarketingConsent(current)).toBe(false);
    expect(hasCurrentRequiredPolicyConsents(current.slice(1))).toBe(false);
    expect(
      hasCurrentRequiredPolicyConsents(
        current.map((record) =>
          record.policy === "privacy" ? { ...record, version: "privacy-superseded" } : record,
        ),
      ),
    ).toBe(false);
  });

  it("treats withdrawal as inactive while preserving the historical grant", () => {
    const records = signupConsentReceipts("2026-08-10T00:00:00.000Z", true).map((receipt) => ({
      policy: receipt.policy,
      version: receipt.version,
      grantedAt: receipt.acceptedAt,
      ...(receipt.policy === "marketing" ? { withdrawnAt: "2026-08-11T00:00:00.000Z" } : {}),
    }));

    expect(records.some(({ policy }) => policy === "marketing")).toBe(true);
    expect(hasCurrentMarketingConsent(records)).toBe(false);
    expect(hasCurrentRequiredPolicyConsents(records)).toBe(true);
  });

  it("accepts only supported, parseable provider metadata receipts", () => {
    const acceptedAt = "2026-08-10T00:00:00.000Z";
    const receipts = policyConsentReceiptsFromMetadata({
      [POLICY_CONSENT_METADATA_KEY]: [
        ...signupConsentReceipts(acceptedAt, true),
        { policy: "terms", version: "old", acceptedAt },
        { policy: "marketing", version: POLICY_VERSIONS.marketing, acceptedAt: "invalid" },
      ],
    });

    expect(receipts).toHaveLength(4);
    expect(receipts.map(({ policy }) => policy)).toContain("marketing");
  });
});
