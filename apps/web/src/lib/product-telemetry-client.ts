"use client";

export type BrowserProductEventName =
  | "landing_view"
  | "pricing_view"
  | "signup_started"
  | "profile_started"
  | "shuffle_started"
  | "card_revealed"
  | "result_viewed"
  | "reading_reopened"
  | "report_previewed"
  | "report_viewed"
  | "outcome_invited";

export type BrowserProductEventProperties = Partial<{
  routeClass:
    "landing" | "pricing" | "signup" | "onboarding" | "ritual" | "result" | "profile" | "report";
  referrerClass: "direct" | "internal" | "external";
  deviceClass: "mobile" | "tablet" | "desktop";
  locale: string;
  cardCount: number;
  statusClass: "started" | "completed" | "pending" | "ready" | "failed";
}>;

/**
 * Emits only the closed browser event/property vocabulary accepted by the
 * server. Callers cannot attach URLs, identifiers, questions, birth data,
 * card identities, report prose, or arbitrary metadata through this API.
 */
export function emitBrowserProductEvent(
  name: BrowserProductEventName,
  properties: BrowserProductEventProperties,
): void {
  void fetch("/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      idempotencyKey: `browser:${crypto.randomUUID()}`,
      name,
      properties,
    }),
    keepalive: true,
  }).catch(() => {
    // Product measurement is deliberately best effort.
  });
}

/**
 * Deduplicates a browser milestone for the current tab without transmitting
 * the receipt scope. The scope may contain an opaque route entity ID because
 * it remains in sessionStorage and never enters the event payload.
 */
export function emitBrowserProductEventOnce(
  name: BrowserProductEventName,
  receiptScope: string,
  properties: BrowserProductEventProperties,
): void {
  const receiptKey = `starguidance-product-event-v1:${name}:${receiptScope}`;
  try {
    if (window.sessionStorage.getItem(receiptKey)) return;
    window.sessionStorage.setItem(receiptKey, "sent");
  } catch {
    // Storage can be unavailable in hardened browser modes. Measurement stays
    // best effort and the product flow must continue.
  }
  emitBrowserProductEvent(name, properties);
}
