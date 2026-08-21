"use client";

import Link from "next/link";

export type ReadingContinuationMode = "choice" | "follow-up" | "closed";

export function ReadingClosure({
  followUpsRemaining,
  onAskFollowUp,
  onClose,
  reflectionQuestion,
}: {
  followUpsRemaining: number;
  onAskFollowUp: () => void;
  onClose: () => void;
  reflectionQuestion: string;
}) {
  return (
    <section aria-labelledby="reading-closure-heading" className="reading-closure">
      <span aria-hidden="true" className="reading-closure-orbit">
        <i />
      </span>
      <p className="reading-section-eyebrow">The threshold back</p>
      <h2 id="reading-closure-heading">Before you leave the cards</h2>
      <blockquote>
        <span>A question to carry</span>
        {reflectionQuestion}
      </blockquote>
      <p>
        Let the reading settle as it is, or ask these exact cards to illuminate one more edge. No
        card will be redrawn.
      </p>
      <div className="reading-closure-actions">
        {followUpsRemaining > 0 && (
          <button className="reading-closure-follow-up" onClick={onAskFollowUp} type="button">
            <span>Continue the thread</span>
            <strong>Ask the same cards</strong>
          </button>
        )}
        <button className="reading-closure-seal" onClick={onClose} type="button">
          <span>Let it settle</span>
          <strong>Close and keep this reading</strong>
        </button>
      </div>
      <small>
        {followUpsRemaining > 0
          ? `${followUpsRemaining} private follow-up${followUpsRemaining === 1 ? "" : "s"} remain with this draw.`
          : "This reading is complete and already preserved in your private history."}
      </small>
    </section>
  );
}

export function ReadingSealed({ readingId }: { readingId: string }) {
  return (
    <section aria-labelledby="reading-sealed-heading" className="reading-sealed">
      <span aria-hidden="true" className="reading-sealed-mark">
        ✦
      </span>
      <p className="reading-section-eyebrow">Reading held</p>
      <h2 id="reading-sealed-heading">The cards are returned, the thread remains.</h2>
      <p>
        This draw, its profile snapshot, and every interpretation are preserved together. Returning
        later will never change its cards.
      </p>
      <div>
        <Link href="/history">Enter your reading constellation</Link>
        <Link href={`/reading/${readingId}`}>Open the preserved reading</Link>
        <Link href="/readings">Begin a new reading</Link>
      </div>
    </section>
  );
}
