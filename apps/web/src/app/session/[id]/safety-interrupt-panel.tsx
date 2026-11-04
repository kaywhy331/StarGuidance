"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { SAFETY_USER_MESSAGES, type SafetyCategory } from "@starguidance/ai";

import { crisisResourcesForLocale } from "./crisis-resources";
import { MysticSanctuaryScene } from "./mystic-sanctuary-scene";

// The browser locale never changes within a page lifetime, so the store never
// notifies subscribers.
function subscribeToNothing() {
  return () => {};
}

/** Reader-facing heading and words for each interrupting category. The body
 * is the ai package's `userMessage` copy; the `guidance` string from
 * `classifyQuestion()` is an instruction for the narrator model and is never
 * rendered. */
export function safetyInterruptCopy(category: SafetyCategory): {
  heading: string;
  body: string;
} {
  const heading =
    category === "selfHarmCrisis"
      ? "Let’s set the cards down for a moment"
      : category === "compulsiveReading"
        ? "Let’s give your last reading room to breathe"
        : "This question needs more care than the cards can give";
  return { heading, body: SAFETY_USER_MESSAGES[category] };
}

/**
 * Shared body for `classifyQuestion()` (@starguidance/ai) results with
 * `interrupt: true` — today that's `selfHarmCrisis` and `compulsiveReading`.
 * There is no "draw anyway" affordance. For `selfHarmCrisis`, real crisis-line
 * contact information is always shown — the international set renders on the
 * server and the locale-specific set replaces it right after hydration, so
 * help is visible even before JavaScript runs.
 *
 * Every action is optional so a caller that already has something worth
 * keeping on screen — an in-progress follow-up on an already-complete
 * reading, say — can show this inline and offer its own way back.
 */
export function SafetyInterruptContent({
  category,
  exitHref,
  exitLabel = "Return to your readings",
  onDismiss,
  dismissLabel = "Return to my reading",
  onRevise,
  recentReadingHref,
  userMessage,
}: {
  category: SafetyCategory;
  /** The API's `safety.userMessage`, when passed through; defaults to the
   * same shared copy. */
  userMessage?: string;
  /** Kept for backward compatibility; the model guidance is never shown. */
  guidance?: string;
  /** A calm way out (e.g. "/history" or "/"). */
  exitHref?: string;
  exitLabel?: string;
  /** Closes an inline interrupt, e.g. to go back to a finished reading. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Returns to the question with the words kept, to ask it differently. */
  onRevise?: () => void;
  /** For `compulsiveReading`: where the recent reading can be reopened. */
  recentReadingHref?: string;
}) {
  // navigator.language is unavailable during SSR; the undefined server
  // snapshot keeps server and hydration renders identical.
  const locale = useSyncExternalStore(
    subscribeToNothing,
    () => navigator.language,
    () => undefined,
  );
  const resources = category === "selfHarmCrisis" ? crisisResourcesForLocale(locale) : undefined;
  const copy = safetyInterruptCopy(category);
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby={headingId}
      className="safety-interrupt-panel"
      data-safety-category={category}
    >
      <h2 id={headingId} ref={headingRef} tabIndex={-1}>
        {copy.heading}
      </h2>
      <p>{userMessage ?? copy.body}</p>
      {resources && (
        <div className="safety-interrupt-resources">
          <h3>{resources.heading}</h3>
          <ul>
            {resources.contacts.map((contact) => (
              <li key={contact.label}>
                <strong>{contact.label}</strong>{" "}
                {contact.href ? (
                  <a href={contact.href}>{contact.detail}</a>
                ) : (
                  <span>{contact.detail}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(onDismiss || onRevise || exitHref || recentReadingHref) && (
        <div className="safety-interrupt-actions">
          {category === "compulsiveReading" && recentReadingHref && (
            <a className="ritual-action" href={recentReadingHref}>
              Open my recent reading
            </a>
          )}
          {onDismiss && (
            <button className="ritual-action" onClick={onDismiss} type="button">
              {dismissLabel}
            </button>
          )}
          {onRevise && category !== "selfHarmCrisis" && (
            <button className="ritual-action" onClick={onRevise} type="button">
              Ask something different
            </button>
          )}
          {onRevise && category === "selfHarmCrisis" && (
            <button className="ritual-action is-quiet" onClick={onRevise} type="button">
              Go back to my question
            </button>
          )}
          {exitHref && (
            <a className="ritual-action is-quiet" href={exitHref}>
              {exitLabel}
            </a>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Full-screen version, for call sites where nothing else is on screen yet —
 * the pre-reading question composer, where replacing the whole view loses
 * nothing. Every action prop is optional and passed through.
 */
export function SafetyInterruptPanel(props: Parameters<typeof SafetyInterruptContent>[0]) {
  return (
    <MysticSanctuaryScene reducedMotion={true} testId="safety-interrupt-panel">
      <SafetyInterruptContent {...props} />
    </MysticSanctuaryScene>
  );
}
