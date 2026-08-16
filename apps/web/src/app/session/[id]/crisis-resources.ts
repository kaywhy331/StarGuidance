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

import { CRISIS_RESOURCE_SETS, type CrisisResourceSet } from "@/config/crisis-resources.v1";

export type { CrisisContact, CrisisResourceSet } from "@/config/crisis-resources.v1";

/**
 * Picks a resource set from a BCP-47 locale tag (e.g. `navigator.language`).
 * Only the region subtag matters — `en-US`, `es-US`, and `US` all resolve the
 * same way. Anything else, including a missing or unrecognised locale, falls
 * back to the international set rather than guessing.
 */
export function crisisResourcesForLocale(locale?: string): CrisisResourceSet {
  const parts = locale?.trim().split("-").filter(Boolean) ?? [];
  const region = (parts.length === 1 ? parts[0] : parts.at(-1))?.toUpperCase();
  if (region === "US") return CRISIS_RESOURCE_SETS.us;
  if (region === "GB" || region === "IE") return CRISIS_RESOURCE_SETS.uk;
  return CRISIS_RESOURCE_SETS.international;
}
