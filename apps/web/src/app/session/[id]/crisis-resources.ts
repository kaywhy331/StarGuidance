/**
 * Real crisis-line contact information shown when `classifyQuestion()`
 * (@starguidance/ai) reports `category: "selfHarmCrisis"`.
 *
 * Detection is deliberately client-side only, keyed off `navigator.language`,
 * and never sent to the server: this app already collects very little client
 * PII, and guessing a region from an HTTP header or IP would be a new and
 * disproportionate collection just to pick which phone number to show. A
 * locale is also only ever a hint — someone travelling, or with their device
 * set to a language that doesn't match where they are, still gets a working
 * international fallback rather than a wrong-country number and nothing else.
 */

export interface CrisisContact {
  readonly label: string;
  readonly detail: string;
  readonly href?: string;
}

export interface CrisisResourceSet {
  readonly region: "us" | "uk" | "international";
  readonly heading: string;
  readonly contacts: readonly CrisisContact[];
}

const US: CrisisResourceSet = {
  region: "us",
  heading: "Immediate support in the United States",
  contacts: [
    {
      label: "988 Suicide & Crisis Lifeline",
      detail: "Call or text 988 — free and available 24/7",
      href: "tel:988",
    },
    {
      label: "Crisis Text Line",
      detail: "Text HOME to 741741",
      href: "sms:741741&body=HOME",
    },
  ],
};

const UK: CrisisResourceSet = {
  region: "uk",
  heading: "Immediate support in the UK and Ireland",
  contacts: [
    {
      label: "Samaritans",
      detail: "Call 116 123 — free and available 24/7",
      href: "tel:116123",
    },
    {
      label: "Shout",
      detail: "Text SHOUT to 85258",
      href: "sms:85258&body=SHOUT",
    },
  ],
};

const INTERNATIONAL: CrisisResourceSet = {
  region: "international",
  heading: "Immediate support",
  contacts: [
    {
      label: "Find A Helpline",
      detail: "findahelpline.com lists crisis lines by country",
      href: "https://findahelpline.com",
    },
  ],
};

/**
 * Picks a resource set from a BCP-47 locale tag (e.g. `navigator.language`).
 * Only the region subtag matters — `en-US`, `es-US`, and `US` all resolve the
 * same way. Anything else, including a missing or unrecognised locale, falls
 * back to the international set rather than guessing.
 */
export function crisisResourcesForLocale(locale?: string): CrisisResourceSet {
  const region = locale?.split("-")[1]?.toUpperCase();
  if (region === "US") return US;
  if (region === "GB" || region === "IE") return UK;
  return INTERNATIONAL;
}
