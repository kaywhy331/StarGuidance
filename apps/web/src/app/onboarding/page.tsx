import { redirect } from "next/navigation";
import { birthProfileInputSchema, type BirthProfileInput } from "@starguidance/contracts";

import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";

import { BirthProfileForm } from "./profile-form";

export const metadata = { title: "Your birth profile" };

export default async function OnboardingPage() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in?next=%2Fonboarding");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  const persistence = persistenceFor(user);
  const activeProfile = await persistence.repositories.birthProfiles.getActive(user.id);
  let initialProfile: BirthProfileInput | undefined;
  if (activeProfile) {
    // A profile saved under older rules still opens for editing; if it no
    // longer parses, the person simply re-enters it rather than hitting an error.
    const parsed = birthProfileInputSchema.safeParse(
      JSON.parse(persistence.decrypt(activeProfile.encryptedInput, "profile-input")),
    );
    if (parsed.success) initialProfile = parsed.data;
  }
  const editing = Boolean(activeProfile);
  return (
    <main className="onboarding-shell">
      <header className="onboarding-intro">
        <p className="eyebrow">
          <span aria-hidden="true">✦</span>{" "}
          {editing ? "Private profile · update your details" : "Private profile · your first step"}
        </p>
        <h1>{editing ? "Adjust what you know." : "Begin with what you know."}</h1>
        <p>
          {editing
            ? "Correct or add to your birth details. Your next readings will use the updated profile; past readings stay as they were."
            : "Your birth name and date of birth are all we need. Birthplace and birth time are optional, and you can simply choose “I don’t know” for either one."}
        </p>
      </header>
      <BirthProfileForm {...(initialProfile ? { initialProfile } : {})} />
    </main>
  );
}
