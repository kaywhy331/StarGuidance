"use client";

import Link from "next/link";
import { forwardRef, useId, useState } from "react";

import { sendJson } from "@/lib/client-request";

export type ReadingContinuationMode = "choice" | "follow-up" | "closed";

export function followUpsRemainingCopy(remaining: number): string {
  return remaining === 1
    ? "1 private follow-up remains with this draw."
    : `${remaining} private follow-ups remain with this draw.`;
}

const RESONANCE_CHOICES = [
  { value: 5, label: "Yes, deeply" },
  { value: 3, label: "Somewhat" },
  { value: 1, label: "Not really" },
] as const;

/** "Did this resonate?" plus an optional private note bound to the reflection
 * prompt. Both post to the reading's existing experience-feedback endpoint:
 * the rating as `resonance`, the note as the encrypted `comment`. */
export function ReadingReflection({
  readingId,
  reflectionQuestion,
  feedbackSubmitted = false,
}: {
  readingId: string;
  reflectionQuestion: string;
  feedbackSubmitted?: boolean;
}) {
  const noteId = useId();
  const [resonance, setResonance] = useState<number>();
  const [ratingState, setRatingState] = useState<"idle" | "saving" | "saved" | "error">(
    feedbackSubmitted ? "saved" : "idle",
  );
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string>();

  const rate = async (value: number) => {
    if (ratingState === "saving") return;
    setResonance(value);
    setRatingState("saving");
    setMessage(undefined);
    const result = await sendJson(`/api/readings/${readingId}/feedback`, "POST", {
      kind: "experience",
      resonance: value,
    });
    if (result.ok) setRatingState("saved");
    else {
      setRatingState("error");
      setMessage(result.error);
    }
  };

  const saveNote = async () => {
    const comment = note.trim();
    if (!comment || noteState === "saving") return;
    setNoteState("saving");
    setMessage(undefined);
    const result = await sendJson(`/api/readings/${readingId}/feedback`, "POST", {
      kind: "experience",
      comment,
    });
    if (result.ok) setNoteState("saved");
    else {
      setNoteState("error");
      setMessage(result.error);
    }
  };

  return (
    <div className="reading-reflection">
      <fieldset className="reading-resonance" disabled={ratingState === "saving"}>
        <legend>Did this reading resonate?</legend>
        {ratingState === "saved" ? (
          <p role="status">Thank you — that helps the readings grow truer.</p>
        ) : (
          <div className="reading-resonance__choices">
            {RESONANCE_CHOICES.map((choice) => (
              <button
                aria-pressed={resonance === choice.value}
                key={choice.value}
                onClick={() => void rate(choice.value)}
                type="button"
              >
                {choice.label}
              </button>
            ))}
          </div>
        )}
      </fieldset>
      <div className="reading-reflection-note">
        <label htmlFor={noteId}>
          A few private words on this question <small>(optional)</small>
        </label>
        <textarea
          disabled={noteState === "saving" || noteState === "saved"}
          id={noteId}
          maxLength={1_000}
          onChange={(event) => setNote(event.target.value)}
          placeholder={reflectionQuestion}
          rows={3}
          value={note}
        />
        <div className="reading-reflection-note__actions">
          <small>Kept encrypted with your feedback. It isn’t shown on the reading.</small>
          {noteState === "saved" ? (
            <span role="status">Your note is saved.</span>
          ) : (
            <button
              className="ritual-action is-quiet"
              disabled={!note.trim() || noteState === "saving"}
              onClick={() => void saveNote()}
              type="button"
            >
              {noteState === "saving" ? "Saving…" : "Save my note"}
            </button>
          )}
        </div>
      </div>
      {message && (
        <p className="sanctuary-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

export const ReadingClosure = forwardRef<
  HTMLHeadingElement,
  {
    followUpsRemaining: number;
    onAskFollowUp: () => void;
    onClose: () => void;
    reflectionQuestion: string;
    /** Enables the resonance rating and private reflection note. */
    readingId?: string;
    feedbackSubmitted?: boolean;
    /** Label for the closing action (default "Close and keep this reading"). */
    closeLabel?: string;
  }
>(function ReadingClosure(
  {
    followUpsRemaining,
    onAskFollowUp,
    onClose,
    reflectionQuestion,
    readingId,
    feedbackSubmitted,
    closeLabel = "Close and keep this reading",
  },
  headingRef,
) {
  return (
    <section aria-labelledby="reading-closure-heading" className="reading-closure">
      <span
        aria-label="The reading is complete"
        className="reading-closure-orbit"
        role="img"
        title="The reading is complete"
      >
        <i aria-hidden="true" />
      </span>
      <p className="reading-section-eyebrow">Before you go</p>
      <h2 id="reading-closure-heading" ref={headingRef} tabIndex={-1}>
        Before you leave the cards
      </h2>
      <blockquote>
        <span>A question to carry</span>
        {reflectionQuestion}
      </blockquote>
      <p>
        Let the reading settle as it is, or ask these same cards one more thing. No card will be
        redrawn.
      </p>
      {readingId && (
        <ReadingReflection
          feedbackSubmitted={feedbackSubmitted ?? false}
          readingId={readingId}
          reflectionQuestion={reflectionQuestion}
        />
      )}
      <div className="reading-closure-actions">
        {followUpsRemaining > 0 && (
          <button className="reading-closure-follow-up" onClick={onAskFollowUp} type="button">
            <span>Continue the thread</span>
            <strong>Ask the same cards</strong>
          </button>
        )}
        <button className="reading-closure-seal" onClick={onClose} type="button">
          <span>Let it settle</span>
          <strong>{closeLabel}</strong>
        </button>
      </div>
      <small>
        {followUpsRemaining > 0
          ? followUpsRemainingCopy(followUpsRemaining)
          : "This reading is complete and kept in your private history."}
      </small>
    </section>
  );
});

export function ReadingSealed({ readingId }: { readingId: string }) {
  return (
    <section aria-labelledby="reading-sealed-heading" className="reading-sealed">
      <span aria-hidden="true" className="reading-sealed-mark">
        ✦
      </span>
      <p className="reading-section-eyebrow">Reading kept</p>
      <h2 id="reading-sealed-heading">The cards are returned, the thread remains.</h2>
      <p>
        This reading is saved in your private history just as it was drawn. Coming back later will
        never change its cards.
      </p>
      <div>
        <Link href="/history">See all your readings</Link>
        <Link href={`/reading/${readingId}`}>Open this reading</Link>
        {/* A full page load, so no half-finished ritual state carries over. */}
        <a href="/readings">Begin a new reading</a>
      </div>
    </section>
  );
}
