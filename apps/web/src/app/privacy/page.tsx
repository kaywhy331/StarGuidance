import { POLICY_EFFECTIVE_DATE, POLICY_VERSIONS } from "@/lib/policies";

export const metadata = { title: "Privacy notice · StarGuidance" };

export default function PrivacyNoticePage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <p className="text-sm tracking-[0.2em] text-[#d8b56d] uppercase">Public notice</p>
      <h1 className="mt-3 text-5xl font-semibold">Privacy notice</h1>
      <p className="mt-4 text-sm text-[#a99db5]">
        Beta version {POLICY_VERSIONS.privacy} · effective {POLICY_EFFECTIVE_DATE}
      </p>

      <div className="mt-10 grid gap-8 text-[#c9bfd4]">
        <section className="grid gap-3">
          <h2 className="text-2xl text-white">What StarGuidance keeps</h2>
          <p>
            We keep your account email, consent receipts, settings, encrypted birth-profile input,
            versioned derived traits, encrypted reading questions and follow-ups, locked card draws,
            reading results, and purchase or entitlement records when you use those features.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="text-2xl text-white">Why it is used</h2>
          <p>
            The data creates your private account, calculates and versions your profile,
            personalizes interpretations without influencing card selection, restores reading
            history, supports privacy requests, prevents abuse, and fulfills products you explicitly
            request.
          </p>
          <p>
            Raw birth facts are encrypted before database storage. The AI boundary receives a small
            plain-language trait lens when enabled—not your full name, exact birth facts,
            birthplace, or raw calculation record.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="text-2xl text-white">Services and choices</h2>
          <p>
            The beta uses infrastructure providers for hosting, authentication, database storage,
            profile calculation, and optional AI or payment functions. We do not sell personal data.
            Public-launch processor terms, regions, retention periods, and contact details still
            require owner legal approval.
          </p>
          <p>
            Signed-in users can export their data and delete individual readings, their private
            profile, or the entire account from Privacy controls. Account deletion removes the Auth
            identity and cascades through user-owned application data.
          </p>
        </section>

        <section className="grid gap-3">
          <h2 className="text-2xl text-white">Age and beta status</h2>
          <p>
            This restricted beta is for people aged 18 or older. This notice is source-controlled
            and versioned for test consent receipts, but it is not a substitute for owner-approved
            legal copy, launch-region review, or a published privacy contact before public release.
          </p>
        </section>
      </div>
    </main>
  );
}
