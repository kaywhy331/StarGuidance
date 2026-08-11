import "server-only";

import { cookies } from "next/headers";

import { getLocalUser } from "./local-store";
import {
  displayNameFromMetadata,
  hasCurrentRequiredPolicyConsents,
  policyConsentReceiptsFromMetadata,
  type StoredPolicyConsent,
} from "./policies";
import { getRepositoriesForUser, getRuntimeAdapter } from "./runtime";
import { createSupabaseServerClient } from "./supabase";

export const SESSION_COOKIE = "starguidance_session";

export const POLICY_RECONSENT_REQUIRED = "POLICY_RECONSENT_REQUIRED";

export function assertCurrentPolicyConsents(user: {
  consentRecords: readonly StoredPolicyConsent[];
}): void {
  if (!hasCurrentRequiredPolicyConsents(user.consentRecords))
    throw new Error(POLICY_RECONSENT_REQUIRED);
}

export async function requireUser() {
  if (getRuntimeAdapter() === "local") {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const user = getLocalUser(token);
    if (!user) throw new Error("UNAUTHENTICATED");
    const repositories = getRepositoriesForUser(user.id);
    const [profile, settings, consentRecords] = await Promise.all([
      repositories.birthProfiles.getActive(user.id),
      repositories.settings.get(user.id),
      repositories.consents.list(user.id),
    ]);
    return {
      ...user,
      profile,
      settings,
      consentRecords,
      requiresPolicyReconsent: !hasCurrentRequiredPolicyConsents(consentRecords),
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) throw new Error("UNAUTHENTICATED");
  const repositories = getRepositoriesForUser(data.user.id);
  const persisted = await repositories.users.ensure({ id: data.user.id, email: data.user.email });
  const [profile, storedSettings, storedConsents] = await Promise.all([
    repositories.birthProfiles.getActive(persisted.id),
    repositories.settings.get(persisted.id),
    repositories.consents.list(persisted.id),
  ]);
  const receipts = policyConsentReceiptsFromMetadata(data.user.app_metadata);
  const existing = new Set(storedConsents.map(({ policy, version }) => `${policy}:${version}`));
  await Promise.all(
    receipts
      .filter(({ policy, version }) => !existing.has(`${policy}:${version}`))
      .map((receipt) =>
        repositories.consents.grant(persisted.id, {
          policy: receipt.policy,
          version: receipt.version,
          grantedAt: receipt.acceptedAt,
        }),
      ),
  );
  const metadataDisplayName = displayNameFromMetadata(data.user.app_metadata);
  if (!storedSettings && metadataDisplayName)
    await repositories.settings.upsert({
      userId: persisted.id,
      displayName: metadataDisplayName,
      soundEnabled: false,
      reducedMotion: false,
    });
  const consents = await repositories.consents.list(persisted.id);
  const settings = storedSettings ?? (await repositories.settings.get(persisted.id));
  return {
    ...persisted,
    profile,
    settings,
    consentRecords: consents,
    requiresPolicyReconsent: !hasCurrentRequiredPolicyConsents(consents),
  };
}
