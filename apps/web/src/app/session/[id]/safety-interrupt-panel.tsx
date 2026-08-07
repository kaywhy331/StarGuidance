"use client";

import { useSyncExternalStore } from "react";
import type { SafetyCategory } from "@starguidance/ai";

import { crisisResourcesForLocale, type CrisisResourceSet } from "./crisis-resources";
import { MysticSanctuaryScene } from "./mystic-sanctuary-scene";

// The browser locale never changes within a page lifetime, so the store never
// notifies subscribers.
function subscribeToNothing() {
  return () => {};
}

/**
 * Shared body for `classifyQuestion()` (@starguidance/ai) results with
 * `interrupt: true` — today that's `selfHarmCrisis` and `compulsiveReading`.
 * There is no "continue" affordance: `guidance` explains what happened, and
 * for `selfHarmCrisis` specifically, real crisis-line contact information is
 * added below it. `compulsiveReading` gets the same treatment minus the
 * resource block — there is no hotline for "take a break from this reading."
 *
 * Exported separately from `SafetyInterruptPanel` so a caller that already
 * has something worth keeping on screen — an in-progress follow-up on an
 * already-complete reading, say — can show this inline instead of replacing
 * the whole view. `compulsiveReading`'s own guidance text says to retain the
 * prior reading; a full-screen takeover would work against that.
 */
export function SafetyInterruptContent({
  category,
  guidance,
}: {
  category: SafetyCategory;
  guidance: string;
}) {
  // navigator.language is unavailable during SSR; the undefined server
  // snapshot keeps server and hydration renders identical, and React re-renders
  // with the client locale immediately after hydration.
  const locale = useSyncExternalStore(
    subscribeToNothing,
    () => navigator.language,
    () => undefined,
  );
  const resources: CrisisResourceSet | undefined =
    category === "selfHarmCrisis" && locale ? crisisResourcesForLocale(locale) : undefined;

  return (
    <div className="safety-interrupt-panel" role="alert">
      <h2>This reading has paused</h2>
      <p>{guidance}</p>
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
    </div>
  );
}

/**
 * Full-screen version, for call sites where nothing else is on screen yet —
 * the pre-reading question composer, where replacing the whole view loses
 * nothing.
 */
export function SafetyInterruptPanel(props: { category: SafetyCategory; guidance: string }) {
  return (
    <MysticSanctuaryScene reducedMotion={true} testId="safety-interrupt-panel">
      <SafetyInterruptContent {...props} />
    </MysticSanctuaryScene>
  );
}
