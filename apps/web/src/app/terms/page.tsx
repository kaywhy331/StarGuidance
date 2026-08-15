import { POLICY_EFFECTIVE_DATE, POLICY_VERSIONS } from "@/lib/policies";

export const metadata = {
  title: "Terms and how to read a reading · StarGuidance",
};

/**
 * The standing statement about what a reading is.
 *
 * This used to be appended to every reading, which made each one hedge itself.
 * It belongs here, linked from every page, so a reading can speak plainly while
 * the terms remain one click away and unambiguous.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-5xl font-semibold">Terms and how to read a reading</h1>
      <p className="mt-4 text-sm text-[#a99db5]">
        Beta version {POLICY_VERSIONS.terms} · effective {POLICY_EFFECTIVE_DATE}
      </p>

      <section className="mt-10 grid gap-4 text-[#c9bfd4]">
        <h2 className="text-2xl text-white">What a reading is</h2>
        <p>
          StarGuidance offers tarot readings for reflection and entertainment. A reading is an
          interpretation of the cards you drew, read against the profile details you provided. It is
          not a factual prediction, and it is not evidence about what has happened or will happen.
        </p>
        <p>
          Cards are selected by a cryptographically secure shuffle before any interpretation is
          written. The draw is locked at that moment and never changes — not on refresh, not on
          retry, and not as a result of anything the interpretation says.
        </p>
      </section>

      <section className="mt-8 grid gap-4 text-[#c9bfd4]">
        <h2 className="text-2xl text-white">What a reading is not</h2>
        <p>
          Nothing here is medical, legal, financial, or psychological advice. StarGuidance does not
          diagnose conditions, predict deaths or pregnancies, determine guilt, or assert private
          facts about other people. For those questions, please speak to someone qualified.
        </p>
        <p>
          If you are in crisis or considering harming yourself, please contact your local emergency
          services or a crisis line in your country. A tarot reading is not the right help, and we
          will say so rather than read the cards.
        </p>
      </section>

      <section className="mt-8 grid gap-4 text-[#c9bfd4]">
        <h2 className="text-2xl text-white">Your data</h2>
        <p>
          Your birth details and questions are encrypted before storage. You can export everything
          held about you, or delete your account and all of its data, from{" "}
          <a className="underline" href="/settings/privacy">
            Privacy controls
          </a>
          .
        </p>
      </section>

      <p className="mt-10 text-sm text-[#8f86a0]">
        This restricted beta is for people aged 18 or older. Decisions you take after a reading
        remain yours. Pricing, refunds, launch regions, governing terms, and final legal copy
        require owner approval before public launch.
      </p>
    </main>
  );
}
