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
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 sm:px-10">
      <p className="text-sm tracking-[0.22em] text-[#d8b56d] uppercase">Private profile</p>
      <h1 className="mt-3 text-4xl font-semibold sm:text-6xl">Begin with what you know.</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-[#c9bfd4]">
        Birth name and date are required. Place and time are optional; they only unlock more detail
        and are never guessed.
      </p>
      <p className="mt-4 max-w-2xl leading-7 text-[#b8adc8]">
        Your private profile personalizes how the cards are interpreted—never which cards are drawn.
        The detailed profile report is a separate paid product; personalized readings do not require
        buying it. Houses and Ascendant stay unavailable unless a validated calculation has the
        context it needs.
      </p>
      <BirthProfileForm {...(initialProfile ? { initialProfile } : {})} />
    </main>
  );
}
