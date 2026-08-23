import { spreads } from "@starguidance/tarot-content";

import { requireUser } from "@/lib/auth";
import { FREE_GUEST_SPREAD_IDS } from "@/lib/guest-reading-contract";

import { GuestReadingExperience } from "./guest-reading-experience";

export const metadata = {
  title: "Free Tarot Reading · StarGuidance",
  description:
    "Experience one private, birthday-personalized tarot reading before choosing whether to create an account.",
};

export default async function FreeReadingPage({
  searchParams,
}: {
  searchParams: Promise<{ continue?: string | string[] }>;
}) {
  let authenticated = false;
  let hasProfile = false;
  let requiresPolicyReconsent = false;
  try {
    const user = await requireUser();
    authenticated = true;
    hasProfile = Boolean(user.profile);
    requiresPolicyReconsent = user.requiresPolicyReconsent;
  } catch {
    // The guest lane is intentionally available before Auth or profile setup.
  }
  const continuation = (await searchParams).continue;
  return (
    <GuestReadingExperience
      authenticated={authenticated}
      continueRequested={(Array.isArray(continuation) ? continuation[0] : continuation) === "1"}
      hasProfile={hasProfile}
      requiresPolicyReconsent={requiresPolicyReconsent}
      spreads={spreads
        .filter(({ id }) => FREE_GUEST_SPREAD_IDS.some((guestId) => guestId === id))
        .map(({ id, version, name, purpose, estimatedMinutes, positions }) => ({
          id: id as (typeof FREE_GUEST_SPREAD_IDS)[number],
          version,
          name,
          purpose,
          estimatedMinutes,
          count: positions.length,
          positions,
        }))}
    />
  );
}
