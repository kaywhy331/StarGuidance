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
          <h2 className="text-2xl text-white">Your free reading before signup</h2>
          <p>
            You can complete one profile-free reading without an account. Your browser creates a
            random device ID; StarGuidance uses it with a signed, HttpOnly trial cookie and a local
            trial marker to remember that this browser has received its free reading. This is not a
            hardware fingerprint, and no birth information is requested or used.
          </p>
          <p>
            The guest question is processed in server memory by the deterministic narrator and is
            not sent to an AI provider, stored in an account database, placed in a URL, or included
            in analytics. The exact question and locked draw are returned only inside an encrypted,
            opaque receipt held by your browser for up to seven days. A display-only copy of the
            result is kept in session storage so an interrupted tab can recover it.
          </p>
          <p>
            A trusted edge network address may be converted immediately into a keyed digest for a
            short abuse-prevention quota. The application does not retain the raw network address in
            that quota. Shared networks are not treated as a permanent identity, and the signed
            browser marker—not IP address—is the normal one-reading boundary.
          </p>
          <p>
            If you choose to sign up or sign in, the server can decrypt the browser-held receipt to
            recover the same cards for a follow-up. Signup never redraws them. The guest question
            and result do not become saved account history through this handoff, and the browser
            removes the receipt after the follow-up succeeds.
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
