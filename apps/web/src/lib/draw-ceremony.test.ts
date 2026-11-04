import { describe, expect, it } from "vitest";

import type { RequestPersistence } from "./persistence";
import { issueDrawCeremony, readDrawCeremony } from "./draw-ceremony";

const userId = "00000000-0000-4000-8000-000000000001";
const profileSnapshotId = "00000000-0000-4000-8000-000000000002";

function persistence(): RequestPersistence {
  return {
    repositories: {} as RequestPersistence["repositories"],
    encrypt: (value) => Buffer.from(value, "utf8").toString("base64url"),
    decrypt: (value) => Buffer.from(value, "base64url").toString("utf8"),
  };
}

const spread = {
  id: "one-card",
  name: "Single Card — Focus",
  purpose: "A focused test spread for ceremony issuance.",
  estimatedMinutes: 3,
  entitlementClass: "standard" as const,
  version: "one-card-v3",
  allowReversals: true,
  optionalCut: true,
  layout: { columns: 1, rows: 1, kind: "centered" as const },
  capabilities: {
    trajectoryPositionIds: [],
    alternativePositionGroups: [],
    timingMethod: null,
    linkedPositions: [],
  },
  positions: [
    {
      id: "card-1",
      displayName: "Focus",
      interpretiveFunction: "the concentrated center",
      description: "The central theme.",
      order: 0,
      placement: { column: 0, row: 0, rotation: 0, layer: 0 },
    },
  ],
};

describe("authenticated draw ceremony", () => {
  it("binds a public commitment to an encrypted private seed and fixed positions", () => {
    const issued = issueDrawCeremony(persistence(), {
      userId,
      deckVersion: "tarot-core-v3",
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
      profileSnapshotId,
      readingLens: { version: "question-trait-lens-v2", traitIndexes: [] },
      question: "What should I understand about this decision?",
      questionClassification: {
        version: "question-classification-v1",
        topic: "change",
        horizon: "open",
        intent: "clarity",
        generalReading: false,
      },
      entitlementDecision: {
        version: "reading-entitlement-v1",
        mode: "unlimited",
        outcome: "granted",
        entitlementClass: "standard",
        used: 0,
        limit: null,
        remaining: null,
        windowStartsAt: null,
        windowEndsAt: null,
      },
      safetyClassification: "ordinary",
      continueAsReflection: false,
      spread,
      reversalMode: "upright_only",
      personalizationMode: "pure_tarot",
      now: new Date("2026-08-22T00:00:00Z"),
    });
    expect(issued.ceremony).not.toHaveProperty("serverSeed");
    expect(issued.ceremony.spread.positions[0]?.displayName).toBe("Focus");
    expect(
      readDrawCeremony(
        persistence(),
        issued.ceremony.token,
        userId,
        Date.parse("2026-08-22T00:30:00Z"),
      ),
    ).toMatchObject({
      readingId: issued.ceremony.sessionId,
      serverSeedCommitment: issued.ceremony.serverSeedCommitment,
      configuration: { reversalMode: "upright_only", personalizationMode: "pure_tarot" },
    });
  });

  it("rejects ownership mismatch and expiry", () => {
    const issued = issueDrawCeremony(persistence(), {
      userId,
      deckVersion: "tarot-core-v3",
      idempotencyKey: "00000000-0000-4000-8000-000000000004",
      profileSnapshotId,
      readingLens: { version: "question-trait-lens-v2", traitIndexes: [] },
      question: "What should I understand now?",
      questionClassification: {
        version: "question-classification-v1",
        topic: "general",
        horizon: "open",
        intent: "clarity",
        generalReading: false,
      },
      entitlementDecision: {
        version: "reading-entitlement-v1",
        mode: "unlimited",
        outcome: "granted",
        entitlementClass: "standard",
        used: 0,
        limit: null,
        remaining: null,
        windowStartsAt: null,
        windowEndsAt: null,
      },
      safetyClassification: "ordinary",
      continueAsReflection: false,
      spread,
      reversalMode: "reversals_enabled",
      personalizationMode: "personalized_tarot",
      now: new Date("2026-08-22T00:00:00Z"),
    });
    expect(() =>
      readDrawCeremony(
        persistence(),
        issued.ceremony.token,
        "00000000-0000-4000-8000-000000000099",
      ),
    ).toThrow(/OWNER/);
    expect(() =>
      readDrawCeremony(
        persistence(),
        issued.ceremony.token,
        userId,
        Date.parse(issued.ceremony.expiresAt) + 1,
      ),
    ).toThrow(/EXPIRED/);
  });
});
