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
          Your birth name and birthdate are required. Birthplace and birth time are optional, and
          you can simply choose “I don&apos;t know” for either one.
        </p>
      </header>
      <BirthProfileForm {...(initialProfile ? { initialProfile } : {})} />
    </main>
  );
}
