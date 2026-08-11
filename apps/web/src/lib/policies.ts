export const POLICY_EFFECTIVE_DATE = "2026-08-05";

export const POLICY_VERSIONS = {
  terms: "terms-beta-2026-08-05",
  privacy: "privacy-beta-2026-08-05",
  ageEligibility: "age-18-beta-2026-08-05",
  marketing: "marketing-beta-v1",
  profilePersonalization: "profile-personalization-v1",
} as const;

export const POLICY_CONSENT_METADATA_KEY = "starguidance_policy_consents";
export const ACCOUNT_DISPLAY_NAME_METADATA_KEY = "starguidance_display_name";

export interface PolicyConsentReceipt {
  policy: "terms" | "privacy" | "age-eligibility" | "marketing";
  version: string;
  acceptedAt: string;
}

export interface StoredPolicyConsent {
  policy: string;
  version: string;
  grantedAt: string;
  withdrawnAt?: string;
}

export function requiredPolicyConsentReceipts(acceptedAt: string): readonly PolicyConsentReceipt[] {
  return [
    { policy: "terms", version: POLICY_VERSIONS.terms, acceptedAt },
    { policy: "privacy", version: POLICY_VERSIONS.privacy, acceptedAt },
    {
      policy: "age-eligibility",
      version: POLICY_VERSIONS.ageEligibility,
      acceptedAt,
    },
  ];
}

export function signupConsentReceipts(
  acceptedAt: string,
  marketingAccepted = false,
): readonly PolicyConsentReceipt[] {
  return [
    ...requiredPolicyConsentReceipts(acceptedAt),
    ...(marketingAccepted
      ? [{ policy: "marketing", version: POLICY_VERSIONS.marketing, acceptedAt } as const]
      : []),
  ];
}

export function hasCurrentRequiredPolicyConsents(records: readonly StoredPolicyConsent[]): boolean {
  return requiredPolicyConsentReceipts("").every(({ policy, version }) =>
    records.some(
      (record) =>
        record.policy === policy && record.version === version && record.withdrawnAt === undefined,
    ),
  );
}

export function hasCurrentMarketingConsent(records: readonly StoredPolicyConsent[]): boolean {
  return records.some(
    (record) =>
      record.policy === "marketing" &&
      record.version === POLICY_VERSIONS.marketing &&
      record.withdrawnAt === undefined,
  );
}

export function displayNameFromMetadata(metadata: Record<string, unknown>): string | undefined {
  const value = metadata[ACCOUNT_DISPLAY_NAME_METADATA_KEY];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 80 ? normalized : undefined;
}

export function policyConsentReceiptsFromMetadata(
  metadata: Record<string, unknown>,
): readonly PolicyConsentReceipt[] {
  const receipts = metadata[POLICY_CONSENT_METADATA_KEY];
  if (!Array.isArray(receipts)) return [];
  const supported = new Map(
    signupConsentReceipts("", true).map(({ policy, version }) => [policy, version] as const),
  );
  return receipts.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    if (
      typeof value.policy !== "string" ||
      typeof value.version !== "string" ||
      typeof value.acceptedAt !== "string" ||
      supported.get(value.policy as PolicyConsentReceipt["policy"]) !== value.version ||
      !Number.isFinite(Date.parse(value.acceptedAt))
    )
      return [];
    return [value as unknown as PolicyConsentReceipt];
  });
}
