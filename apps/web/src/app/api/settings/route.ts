import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import {
  hasCurrentMarketingConsent,
  hasCurrentRequiredPolicyConsents,
  POLICY_VERSIONS,
  requiredPolicyConsentReceipts,
} from "@/lib/policies";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

const accountSettingsSchema = z.object({
  action: z.literal("update-account-settings"),
  displayName: z.string().trim().min(1).max(80),
  soundEnabled: z.boolean(),
  reducedMotion: z.boolean(),
  marketingAccepted: z.boolean(),
  marketingVersion: z.literal(POLICY_VERSIONS.marketing),
});

const readingPreferencesSchema = z.object({
  action: z.literal("update-reading-preferences"),
  soundEnabled: z.boolean(),
  reducedMotion: z.boolean(),
});

const requiredConsentSchema = z.object({
  action: z.literal("accept-required-policies"),
  termsAccepted: z.literal(true),
  termsVersion: z.literal(POLICY_VERSIONS.terms),
  privacyAccepted: z.literal(true),
  privacyVersion: z.literal(POLICY_VERSIONS.privacy),
  ageConfirmed: z.literal(true),
  ageEligibilityVersion: z.literal(POLICY_VERSIONS.ageEligibility),
});

const updateSchema = z.discriminatedUnion("action", [
  accountSettingsSchema,
  readingPreferencesSchema,
  requiredConsentSchema,
]);

function settingsPayload(user: Awaited<ReturnType<typeof requireUser>>) {
  return {
    settings: user.settings ?? {
      userId: user.id,
      displayName: "Reader",
      soundEnabled: true,
      reducedMotion: false,
    },
    settingsPersisted: Boolean(user.settings),
    consents: {
      requiredCurrent: hasCurrentRequiredPolicyConsents(user.consentRecords),
      marketingAccepted: hasCurrentMarketingConsent(user.consentRecords),
      versions: POLICY_VERSIONS,
    },
    nextPath: user.profile ? "/readings" : "/onboarding",
  };
}

export async function GET() {
  try {
    return NextResponse.json(settingsPayload(await requireUser()));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ error: "Account settings could not be loaded." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`settings:${user.id}`, 30);
    const input = updateSchema.parse(await request.json());
    const repositories = persistenceFor(user).repositories;
    const now = new Date().toISOString();

    if (input.action === "accept-required-policies") {
      await Promise.all(
        requiredPolicyConsentReceipts(now).map((receipt) =>
          repositories.consents.grant(user.id, {
            policy: receipt.policy,
            version: receipt.version,
            grantedAt: receipt.acceptedAt,
          }),
        ),
      );
      await recordAudit(user.id, "consent.required.accepted", "account", user.id);
    } else {
      const current = await repositories.settings.get(user.id);
      await repositories.settings.upsert({
        userId: user.id,
        displayName:
          input.action === "update-account-settings"
            ? input.displayName
            : (current?.displayName ?? "Reader"),
        soundEnabled: input.soundEnabled,
        reducedMotion: input.reducedMotion,
      });

      if (input.action === "update-account-settings") {
        if (input.marketingAccepted)
          await repositories.consents.grant(user.id, {
            policy: "marketing",
            version: input.marketingVersion,
            grantedAt: now,
          });
        else await repositories.consents.withdraw(user.id, "marketing", now);
        await recordAudit(user.id, "account.settings.updated", "account", user.id);
      } else await recordAudit(user.id, "reading.preferences.updated", "account", user.id);
    }

    return NextResponse.json(settingsPayload(await requireUser()));
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: "Check the account settings and try again." },
        { status: 422 },
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ error: "Account settings could not be saved." }, { status: 500 });
  }
}
