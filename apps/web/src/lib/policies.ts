export const POLICY_EFFECTIVE_DATE = "2026-08-05";

export const POLICY_VERSIONS = {
  terms: "terms-beta-2026-08-05",
  privacy: "privacy-beta-2026-08-05",
  ageEligibility: "age-18-beta-2026-08-05",
  profilePersonalization: "profile-personalization-v1",
} as const;

export const POLICY_CONSENT_METADATA_KEY = "starguidance_policy_consents";

export interface PolicyConsentReceipt {
  policy: "terms" | "privacy" | "age-eligibility";
  version: string;
  acceptedAt: string;
}

export function signupConsentReceipts(acceptedAt: string): readonly PolicyConsentReceipt[] {
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

export function policyConsentReceiptsFromMetadata(
  metadata: Record<string, unknown>,
): readonly PolicyConsentReceipt[] {
  const receipts = metadata[POLICY_CONSENT_METADATA_KEY];
  if (!Array.isArray(receipts)) return [];
  const required = new Map(
    signupConsentReceipts("").map(({ policy, version }) => [policy, version] as const),
  );
  return receipts.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const value = candidate as Record<string, unknown>;
    if (
      typeof value.policy !== "string" ||
      typeof value.version !== "string" ||
      typeof value.acceptedAt !== "string" ||
      required.get(value.policy as PolicyConsentReceipt["policy"]) !== value.version ||
      !Number.isFinite(Date.parse(value.acceptedAt))
    )
      return [];
    return [value as unknown as PolicyConsentReceipt];
  });
}
