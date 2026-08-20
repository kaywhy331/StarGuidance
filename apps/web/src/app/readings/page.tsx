import { redirect } from "next/navigation";
import { spreads } from "@starguidance/tarot-content";

import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { readingEntitlementDecision } from "@/lib/reading-policy";
import { getRuntimeConfiguration } from "@/lib/runtime-configuration";

import { ReadingChooser } from "./reading-chooser";

export default async function ReadingsPage() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  if (!user.profile) redirect("/onboarding");
  const [readings, runtimeConfiguration] = await Promise.all([
    persistenceFor(user).repositories.readingSessions.list(user.id),
    getRuntimeConfiguration(),
  ]);
  const access = readingEntitlementDecision(readings, undefined, runtimeConfiguration.commerce);
  const enabledSpreads = new Set(runtimeConfiguration.content.enabledSpreadIds);
  return (
    <ReadingChooser
      access={access}
      animationVariant={
        runtimeConfiguration.features.animationsEnabled
          ? runtimeConfiguration.features.animationVariant
          : "disabled"
      }
      {...(user.settings ? { initialPreferences: user.settings } : {})}
      spreads={spreads
        .filter(({ id }) => enabledSpreads.has(id))
        .map(({ id, name, purpose, estimatedMinutes, entitlementClass, positions }) => ({
          id,
          name,
          purpose,
          estimatedMinutes,
          entitlementClass,
          count: positions.length,
        }))}
    />
  );
}
