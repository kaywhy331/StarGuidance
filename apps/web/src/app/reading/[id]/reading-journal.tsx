"use client";

import { useId, useState } from "react";

import { sendJson } from "@/lib/client-request";

/** A reading must be at least this old before we invite an outcome note. */
export const JOURNAL_INVITE_AFTER_MS = 3 * 24 * 60 * 60 * 1_000;

const UNFOLDED_CHOICES = [
  { value: "occurred", glyph: "●", label: "It came to pass" },
  { value: "partial", glyph: "◐", label: "Partly" },
  { value: "did_not_occur", glyph: "○", label: "It didn’t" },
  { value: "unclear", glyph: "◌", label: "Still unfolding" },
] as const;

const SHAPED_CHOICES = [
  { value: true, label: "Yes, it did" },
  { value: false, label: "Not really" },
] as const;

type UnfoldedValue = (typeof UNFOLDED_CHOICES)[number]["value"];

/** True once a reading is old enough to reflect on how it unfolded. */
export function journalInviteOpen(createdAt: string, now: number): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && now - created >= JOURNAL_INVITE_AFTER_MS;
}

/**
 * Outcome feedback reframed as a private journal entry. Posts the same
 * `kind: "outcome"` payload the feedback API has always accepted.
 */
export function ReadingJournal({
  readingId,
  createdAt,
  submitted,
  now,
  onSaved,
}: {
  readingId: string;
  createdAt: string;
  submitted: boolean;
  now: number;
  onSaved: () => void;
}) {
  const noteId = useId();
  const [unfolded, setUnfolded] = useState<UnfoldedValue>();
  const [shaped, setShaped] = useState<boolean>();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (submitted)
    return (
      <p className="reading-journal reading-journal--saved" role="status">
        Your journal entry is saved beside this reading. The reading itself stays exactly as it was.
      </p>
    );

  const save = async () => {
    if (!unfolded || shaped === undefined || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      const result = await sendJson(`/api/readings/${readingId}/feedback`, "POST", {
        kind: "outcome",
        outcomeStatus: unfolded,
        behaviorChanged: shaped,
        ...(note.trim() ? { comment: note.trim() } : {}),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const form = (
    <div className="reading-journal__form">
      <fieldset>
        <legend>How did this unfold?</legend>
        <div className="reading-journal__chips">
          {UNFOLDED_CHOICES.map((choice) => (
            <button
              aria-pressed={unfolded === choice.value}
              key={choice.value}
              onClick={() => setUnfolded(choice.value)}
              type="button"
            >
              <span aria-hidden="true">{choice.glyph}</span> {choice.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Did the reading shape what you did?</legend>
        <div className="reading-journal__chips">
          {SHAPED_CHOICES.map((choice) => (
            <button
              aria-pressed={shaped === choice.value}
              key={String(choice.value)}
              onClick={() => setShaped(choice.value)}
              type="button"
            >
              {choice.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label htmlFor={noteId}>
        Note to your future self <small>(optional)</small>
      </label>
      <textarea
        id={noteId}
        maxLength={1_000}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What do you want to remember about how this went?"
        rows={3}
        value={note}
      />
      <div className="reading-journal__actions">
        <small>Private and encrypted. It never changes the cards or the reading.</small>
        <button
          className="ritual-action is-quiet"
          disabled={!unfolded || shaped === undefined || saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Saving…" : "Save to my journal"}
        </button>
      </div>
      {error ? (
        <p className="sanctuary-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );

  if (journalInviteOpen(createdAt, now))
    return (
      <section aria-labelledby={`${noteId}-heading`} className="reading-journal">
        <p className="reading-section-eyebrow">Your journal</p>
        <h2 id={`${noteId}-heading`}>Looking back on this reading</h2>
        {form}
      </section>
    );

  return (
    <details className="reading-journal reading-journal--later">
      <summary>Come back later to reflect on how this unfolded</summary>
      <p>
        In a few days, return here to note how things went. It’s a private journal entry, not a test
        of the cards.
      </p>
      {form}
    </details>
  );
}
