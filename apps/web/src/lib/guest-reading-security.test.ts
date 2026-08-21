import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuestReceiptPayload } from "./guest-reading-contract";
import {
  assertGuestTrialConfigured,
  GuestTrialConfigurationError,
  guestTrialNetworkRateLimitKey,
  issueGuestReadingReceipt,
  issueGuestTrialMarker,
  verifyGuestReadingReceipt,
  verifyGuestTrialMarker,
} from "./guest-reading-security";

const now = Date.parse("2026-08-21T20:00:00.000Z");
const basePayload: Omit<GuestReceiptPayload, "version" | "expiresAt"> = {
  readingId: "6f6cc82f-f795-4684-a545-a31bdc01ca42",
  question: "What should I notice about this transition?",
  questionClassification: {
    version: "question-classification-v1",
    topic: "change",
    horizon: "weeks",
    intent: "clarity",
    generalReading: false,
  },
  draw: {
    id: "6f6cc82f-f795-4684-a545-a31bdc01ca42",
    deckVersion: "tarot-deck-v3",
    spreadId: "one-card",
    spreadVersion: "one-card-v2",
    shuffleVersion: "fisher-yates-csprng-v1",
    assignments: [{ positionId: "card-1", cardId: "the-fool", orientation: "upright", order: 0 }],
    lockedAt: "2026-08-21T20:00:00.000Z",
  },
  result: {
    schemaVersion: "reading-result-v2",
    title: "A beginning asks for attention",
    passages: [
      { id: "opening", role: "opening", text: "A beginning is present.", cardReferences: [] },
      {
        id: "thread-1",
        role: "underlyingPattern",
        text: "The Fool holds the central thread.",
        cardReferences: ["card-1"],
      },
      {
        id: "likely",
        role: "trajectory",
        text: "The next step stays conditional.",
        cardReferences: ["card-1"],
      },
      {
        id: "alternate",
        role: "alternative",
        text: "Waiting remains another path.",
        cardReferences: ["card-1"],
      },
    ],
    cards: [
      {
        positionId: "card-1",
        cardId: "the-fool",
        orientation: "upright",
        passageIds: ["thread-1", "likely", "alternate"],
      },
    ],
    trajectory: {
      likelyPassageId: "likely",
      conditions: ["new evidence remains welcome"],
      alternatePassageId: "alternate",
    },
    userAgency: ["Choose one reversible next step."],
    reflectionQuestion: "What becomes possible if certainty is not required?",
    disconfirmingEvidence: ["The situation stops changing."],
    uncertainty: "This is reflection, not a guarantee.",
    safetyFlags: [],
  },
  createdAt: "2026-08-21T20:00:00.000Z",
};

beforeEach(() => {
  vi.stubEnv("GUEST_TRIAL_SECRET", Buffer.alloc(32, 19).toString("base64"));
});

afterEach(() => vi.unstubAllEnvs());

describe("guest reading receipts", () => {
  it("encrypts and authenticates a same-draw signup handoff", () => {
    const issued = issueGuestReadingReceipt(basePayload, now);

    expect(issued.receipt).not.toContain(basePayload.question);
    expect(verifyGuestReadingReceipt(issued.receipt, now)).toMatchObject(basePayload);
  });

  it("rejects tampering and expiry", () => {
    const issued = issueGuestReadingReceipt(basePayload, now);
    const tampered = `${issued.receipt.slice(0, -1)}${issued.receipt.endsWith("a") ? "b" : "a"}`;

    expect(verifyGuestReadingReceipt(tampered, now)).toBeUndefined();
    expect(
      verifyGuestReadingReceipt(issued.receipt, Date.parse(issued.expiresAt) + 1),
    ).toBeUndefined();
  });
});

describe("guest trial markers", () => {
  it("binds the signed marker to the browser-generated device ID", () => {
    const device = "298741d3-1dc1-4563-9a4f-52a4cfa0be67";
    const marker = issueGuestTrialMarker(device, now);

    expect(verifyGuestTrialMarker(marker, device, now)).toBe(true);
    expect(verifyGuestTrialMarker(marker, "6872e2aa-516a-4ea6-a03d-755ac1bc2a36", now)).toBe(false);
  });

  it("derives an opaque stable network bucket without creating a fingerprint", () => {
    const key = guestTrialNetworkRateLimitKey("client:192.0.2.8");

    expect(key).toMatch(/^guest-trial:[a-f0-9]{64}$/);
    expect(key).not.toContain("192.0.2.8");
    expect(guestTrialNetworkRateLimitKey("client:192.0.2.8")).toBe(key);
    expect(guestTrialNetworkRateLimitKey("client:unresolved")).toBeUndefined();
  });

  it("fails closed when the deployment has no valid signing secret", () => {
    vi.stubEnv("GUEST_TRIAL_SECRET", "not-a-key");

    expect(assertGuestTrialConfigured).toThrow(GuestTrialConfigurationError);

    vi.stubEnv("GUEST_TRIAL_SECRET", ` ${Buffer.alloc(32, 19).toString("base64")}`);
    expect(assertGuestTrialConfigured).toThrow(GuestTrialConfigurationError);
  });
});
