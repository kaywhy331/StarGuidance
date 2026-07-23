import { BirthProfileForm } from "./profile-form";

export default function OnboardingPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12 sm:px-10">
      <p className="text-sm tracking-[0.22em] text-[#d8b56d] uppercase">Private profile</p>
      <h1 className="mt-3 text-4xl font-semibold sm:text-6xl">Begin with what you know.</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8 text-[#c9bfd4]">
        Birth name and date are required. Place and time are optional; they only unlock more detail
        and are never guessed.
      </p>
      <BirthProfileForm />
    </main>
  );
}
