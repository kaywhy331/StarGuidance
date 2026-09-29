import Link from "next/link";

import { POLICY_EFFECTIVE_DATE } from "@/lib/policies";

export const metadata = { title: "Privacy notice" };

/**
 * Each section leads with a plain summary; the precise detail sits in a
 * "How this works" disclosure so nothing is hidden, only quieter.
 */
export default function PrivacyNoticePage() {
  return (
    <main className="policy-page">
      <p className="page-eyebrow">Privacy</p>
      <h1>Privacy notice</h1>
      <p className="policy-page__meta">Last updated {POLICY_EFFECTIVE_DATE}</p>

      <section className="policy-section">
        <h2>What StarGuidance keeps</h2>
        <p className="policy-section__summary">
          We keep what&apos;s needed to run your account and your readings, and your most personal
          details are encrypted.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            We keep your account email, a record of the policies you agreed to, your settings, your
            encrypted birth-profile details, the traits calculated from them (with a record of which
            calculation produced them), your encrypted reading questions and follow-ups, the cards
            drawn for each reading, reading results, and purchase records when you use those
            features.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>Your free reading before signing up</h2>
        <p className="policy-section__summary">
          You can have one reading without an account. Your birthday is used for that reading and
          then discarded, and your question stays in an encrypted copy kept by your own browser.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            Your browser creates a random device ID. StarGuidance uses it with a signed cookie that
            page scripts cannot read, plus a marker in your browser, to remember that this browser
            has had its free reading. This is not a hardware fingerprint.
          </p>
          <p>
            Your birthday is sent only to StarGuidance&apos;s private calculation service. The
            reading is written from a small set of numerology traits drawn from that date — not the
            raw date itself. The raw birthday is discarded after that request and is not placed in
            the encrypted reading your browser keeps, the account database, browser storage, the
            page address, or analytics. It never influences which cards are drawn and is not sent to
            an AI service.
          </p>
          <p>
            A free reading is written from a curated library of card meanings rather than a live AI
            model. Your question is handled in server memory while it is written, and is not sent to
            an AI service, stored in an account database, placed in the page address, or included in
            analytics. The exact question and the cards drawn are returned only inside an encrypted
            copy held by your browser for up to seven days. A display-only copy of the result is
            kept in this tab&apos;s session storage so an interrupted tab can recover it.
          </p>
          <p>
            To prevent abuse, your network address may be turned straight away into a one-way,
            secret-keyed code used for a short limit on free readings. The raw address is not kept
            for that limit. Shared networks are not treated as one person, and the browser marker —
            not your IP address — is what normally limits a browser to one free reading.
          </p>
          <p>
            If you choose to sign up or sign in, the server can unlock the copy your browser holds
            to recover the same cards for a follow-up. Signing up never redraws them. The guest
            question and result do not become saved account history through this step, and your
            browser deletes its copy once the follow-up succeeds.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>Why it is used</h2>
        <p className="policy-section__summary">
          Your details are used to run your account and to personalize how readings are written —
          never to choose your cards, and never sold.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            The data creates your private account, calculates and keeps a history of your profile,
            personalizes interpretations without influencing which cards are drawn, restores your
            reading history, supports privacy requests, prevents abuse, and fulfils products you
            explicitly request.
          </p>
          <p>
            Raw birth details are encrypted before they are stored. When AI writing is used, it
            receives only a short, plain-language summary of traits — not your full name, exact
            birth details, birthplace, or the raw calculation record.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>Services we rely on, and your choices</h2>
        <p className="policy-section__summary">
          We use trusted companies to host the service, and you can export or delete your data at
          any time from <Link href="/settings/privacy">Privacy controls</Link>.
        </p>
        <details className="policy-details">
          <summary>How this works</summary>
          <p>
            StarGuidance uses outside services for hosting, sign-in, database storage, profile
            calculation, and optional AI writing or payments. We do not sell personal data.
          </p>
          <p>
            For signed-in readings, an optional Audio reading setting may be available. Turning it
            on does not create or send audio; it only shows a play button. When you press play,
            StarGuidance sends that one displayed reading heading and passage to Fish Audio to turn
            it into speech, then requests another passage only if playback reaches it. We do not add
            your raw birth details, profile record, account email, drawn cards, or exact question to
            that voice request, although the reading passage itself may reflect what you asked.
            StarGuidance does not save the generated audio; listened passages stay only in that
            browser tab for playback. Guest readings do not use this voice service.
          </p>
          <p>
            Signed-in users can export their data and delete individual readings, their private
            profile, or the entire account from Privacy controls. Deleting your account removes your
            sign-in identity and all of the data that belongs to it.
          </p>
        </details>
      </section>

      <section className="policy-section">
        <h2>Age and changes</h2>
        <p className="policy-section__summary">StarGuidance is for people aged 18 or older.</p>
        <p>
          StarGuidance is still in an early preview. This notice may be updated; we&apos;ll ask you
          to review any changes before you continue.
        </p>
      </section>
    </main>
  );
}
