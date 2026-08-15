import { redirect } from "next/navigation";
import { spreads } from "@starguidance/tarot-content";

import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { readingEntitlementDecision } from "@/lib/reading-policy";

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
  const readings = await persistenceFor(user).repositories.readingSessions.list(user.id);
  const access = readingEntitlementDecision(readings);
  return (
    <ReadingChooser
      access={access}
      {...(user.settings ? { initialPreferences: user.settings } : {})}
      spreads={spreads.map(
        ({ id, name, purpose, estimatedMinutes, entitlementClass, positions }) => ({
          id,
          name,
          purpose,
          estimatedMinutes,
          entitlementClass,
          count: positions.length,
        }),
      )}
    />
  );
}
