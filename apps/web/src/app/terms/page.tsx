import Link from "next/link";

import { POLICY_EFFECTIVE_DATE } from "@/lib/policies";

export const metadata = {
  title: "Terms and how to read a reading",
};

/**
 * The standing statement about what a reading is.
 *
 * This used to be appended to every reading, which made each one hedge itself.
 * It belongs here, linked from every page, so a reading can speak plainly while
 * the terms remain one click away and unambiguous.
 *
 * Each section leads with a plain summary; the precise detail sits in a
 * "How this works" disclosure so nothing is hidden, only quieter.
 */
export default function TermsPage() {
  return (
    <main className="policy-page">
      <p className="page-eyebrow">Terms</p>
      <h1>Terms and how to read a reading</h1>
      <p className="policy-page__meta">Last updated {POLICY_EFFECTIVE_DATE}</p>

      <section className="policy-section">
        <h2>What a reading is</h2>
        <p className="policy-section__summary">
          A reading is a space for reflection. It can help you think something through, but it is
          not a prediction or a statement of fact.
        </p>
        <p>
          StarGuidance offers tarot readings for reflection and entertainment. The cards fall as
          they fall — nothing you share can steer them — and your details shape only how a reading
          is written.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            A free guest reading uses only stable traits derived from the birthday you provide;
            account readings may use the fuller private profile details you provide to shape
            interpretation. Neither is a factual prediction or evidence about what has happened or
            will happen.
          </p>
          <p>
            Cards are chosen by a cryptographically secure shuffle before any interpretation is
            written. The draw is fixed at that moment and never changes — not on refresh, not on
            retry, and not as a result of anything the interpretation says.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>Your free reading, and continuing with an account</h2>
        <p className="policy-section__summary">
          Adults can try one free reading in a browser before creating an account. If you sign up
          afterwards, you can ask the same cards a follow-up — they are never redrawn.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            We use a signed browser marker and a short network-level limit to prevent automated or
            repeated free readings, without hardware fingerprinting. Signing up or signing in lets
            you ask the same cards a follow-up; creating an account does not entitle StarGuidance to
            redraw them.
          </p>
          <p>
            Your guest birthday is processed briefly by our private calculation service. It is not
            placed in the reading your browser keeps, and it is not saved to account history. It
            personalizes the interpretation only and never affects which cards are drawn.
          </p>
          <p>
            A guest reading is not saved to account history. Saved readings, personalized profile
            use, purchases, export, and account deletion controls are available once you have an
            account.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>What a reading is not</h2>
        <p className="policy-section__summary">
          A reading is not medical, legal, financial, or psychological advice. For those questions,
          please speak to someone qualified.
        </p>
        <p>
          StarGuidance does not diagnose conditions, predict deaths or pregnancies, determine guilt,
          or claim private facts about other people.
        </p>
        <p>
          If you are in crisis or considering harming yourself, please contact your local emergency
          services or a crisis line in your country. A tarot reading is not the right help, and we
          will say so rather than read the cards.
        </p>
      </section>

      <section className="policy-section">
        <h2>Your data</h2>
        <p className="policy-section__summary">
          Your details are private and yours to take or delete at any time from{" "}
          <Link href="/settings/privacy">Privacy controls</Link>.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            Account birth details and questions are encrypted before they are stored. The question
            from a free guest reading is kept only in an encrypted copy held by your browser, as
            described in the <Link href="/privacy">Privacy Notice</Link>. You can export everything
            held in your account, or delete the account and all of its data.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>Age and changes</h2>
        <p className="policy-section__summary">
          StarGuidance is for people aged 18 or older. Decisions you take after a reading remain
          yours.
        </p>
        <p>
          StarGuidance is still in an early preview. These terms may be updated; we&apos;ll ask you
          to review any changes before you continue.
        </p>
      </section>
    </main>
  );
}
