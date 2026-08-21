import { redirect } from "next/navigation";
import { birthProfileInputSchema, type BirthProfileInput } from "@starguidance/contracts";

import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";

import { BirthProfileForm } from "./profile-form";

export default async function OnboardingPage() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  const persistence = persistenceFor(user);
  const activeProfile = await persistence.repositories.birthProfiles.getActive(user.id);
  let initialProfile: BirthProfileInput | undefined;
  if (activeProfile) {
    initialProfile = birthProfileInputSchema.parse(
      JSON.parse(persistence.decrypt(activeProfile.encryptedInput, "profile-input")),
    );
  }
  return (
    <main className="onboarding-shell">
      <header className="onboarding-intro">
        <p className="eyebrow">
          <span aria-hidden="true">✦</span> Private profile · your first threshold
        </p>
        <h1>Begin with what you know.</h1>
        <p>
          Two essentials create a meaningful starting point. Optional place and time simply widen
          what can be calculated safely; absence is never filled with an assumption.
        </p>
        <div className="onboarding-integrity-note">
          <span aria-hidden="true">◇</span>
          <span>
            Your profile shapes <em>how</em> the cards are read—never which cards are drawn.
          </span>
        </div>
      </header>
      <BirthProfileForm {...(initialProfile ? { initialProfile } : {})} />
    </main>
  );
}
