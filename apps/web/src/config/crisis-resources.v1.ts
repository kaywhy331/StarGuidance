/**
 * Reviewed crisis-resource content is versioned separately from UI code so a
 * contact change has one auditable diff and can be rolled back independently.
 * Locale is only a client-side hint; the international directory is always
 * the fallback.
 */
export const CRISIS_RESOURCES_VERSION = "crisis-resources-2026-08-11-v1" as const;

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

export const CRISIS_RESOURCE_SETS: Readonly<
  Record<CrisisResourceSet["region"], CrisisResourceSet>
> = {
  us: {
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
  },
  uk: {
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
  },
  international: {
    region: "international",
    heading: "Immediate support",
    contacts: [
      {
        label: "Find A Helpline",
        detail: "findahelpline.com lists crisis lines by country",
        href: "https://findahelpline.com",
      },
    ],
  },
};
