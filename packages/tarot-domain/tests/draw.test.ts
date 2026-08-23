import { describe, expect, it } from "vitest";

import {
  commitDrawServerSeed,
  createFollowUpLineage,
  createLockedDraw,
  finalizeCommittedDraw,
  retryLockedDraw,
  secureShuffle,
} from "../src";
import type { Spread, TarotCard } from "../src";

const cards: TarotCard[] = Array.from({ length: 8 }, (_, index) => ({
  id: `card-${index}`,
  name: `Card ${index}`,
  arcana: "major",
  suit: null,
  rank: String(index),
  uprightThemes: ["movement"],
  reversedThemes: ["delay"],
  eventTags: ["development"],
  reflectivePrompt: "What changes?",
  contentVersion: "test-v1",
  attribution: "test",
  artwork: {
    artworkId: "test-art-v1",
    frontAsset: "/test-front.svg",
    backAsset: "/test-back.webp",
    altText: "Test illustration",
    artistCredit: "Test",
    license: "Test only",
    source: "Test fixture",
    provenance: "Test fixture",
    focalPoint: { x: 0.5, y: 0.5 },
    crop: "center",
    artworkVersion: "test-v1",
  },
}));
const spread: Spread = {
  id: "test-spread",
  name: "Test Spread",
  purpose: "A synthetic spread used only to verify secure draw behavior.",
  estimatedMinutes: 1,
  entitlementClass: "standard",
  version: "test-v1",
  allowReversals: true,
  optionalCut: true,
  layout: { columns: 3, rows: 1, kind: "horizontal" },
  positions: [0, 1, 2].map((order) => ({
    id: `position-${order}`,
    displayName: `Position ${order}`,
    interpretiveFunction: "test",
    description: "test",
    order,
    placement: { column: order, row: 0, rotation: 0, layer: 0 },
  })),
};

describe("locked draw", () => {
  it("uses unbiased Fisher-Yates bounds and produces no duplicates", () => {
    const bounds: number[] = [];
    const shuffled = secureShuffle([1, 2, 3, 4], (maximum) => {
      bounds.push(maximum);
      return 0;
    });
    expect(bounds).toEqual([4, 3, 2]);
    expect(new Set(shuffled).size).toBe(4);
  });

  it("locks cards and independently assigns reversals", () => {
    const values = [0, 0, 0, 0, 0, 0, 1, 0, 1];
    const draw = createLockedDraw({
      cards,
      deckVersion: "test-deck-v1",
      spread,
      id: "reading-1",
      now: new Date("2026-01-01T00:00:00Z"),
      random: (maximum) => (values.shift() ?? 0) % maximum,
    });
    expect(new Set(draw.assignments.map(({ cardId }) => cardId)).size).toBe(3);
    expect(Object.isFrozen(draw)).toBe(true);
    expect(Object.isFrozen(draw.assignments)).toBe(true);
  });

  it("reuses the same locked object for retries and follow-ups", () => {
    const draw = createLockedDraw({
      cards,
      deckVersion: "test-deck-v1",
      spread,
    });
    expect(retryLockedDraw(draw)).toBe(draw);
    expect(createFollowUpLineage(draw, "follow-up-1").draw).toBe(draw);
  });

  it("finalizes deterministically from committed server entropy and a browser nonce", () => {
    const serverSeed = Buffer.alloc(32, 7).toString("base64url");
    const clientNonce = Buffer.alloc(32, 19).toString("base64url");
    const input = {
      cards,
      deckVersion: "test-deck-v1",
      spread,
      sessionId: "reading-committed-1",
      serverSeed,
      serverSeedCommitment: commitDrawServerSeed(serverSeed),
      clientNonce,
      cutIndex: 0,
      reversalMode: "reversals_enabled" as const,
      now: new Date("2026-01-01T00:00:00Z"),
    };
    expect(finalizeCommittedDraw(input)).toEqual(finalizeCommittedDraw(input));
    expect(finalizeCommittedDraw(input).proof).toMatchObject({
      cutIndex: 0,
      reversalMode: "reversals_enabled",
    });
  });

  it("applies a selected cut as a measurable rotation before assignment", () => {
    const serverSeed = Buffer.alloc(32, 11).toString("base64url");
    const clientNonce = Buffer.alloc(32, 23).toString("base64url");
    const common = {
      cards,
      deckVersion: "test-deck-v1",
      spread,
      sessionId: "reading-committed-cut",
      serverSeed,
      serverSeedCommitment: commitDrawServerSeed(serverSeed),
      clientNonce,
      reversalMode: "upright_only" as const,
    };
    const uncut = finalizeCommittedDraw({ ...common, cutIndex: 0 });
    const cut = finalizeCommittedDraw({ ...common, cutIndex: 2 });
    expect(cut.assignments.map(({ cardId }) => cardId)).not.toEqual(
      uncut.assignments.map(({ cardId }) => cardId),
    );
    expect(cut.proof?.cutIndex).toBe(2);
  });

  it("keeps every card upright when reversals are disabled", () => {
    const serverSeed = Buffer.alloc(32, 13).toString("base64url");
    const draw = finalizeCommittedDraw({
      cards,
      deckVersion: "test-deck-v1",
      spread,
      sessionId: "reading-upright-only",
      serverSeed,
      serverSeedCommitment: commitDrawServerSeed(serverSeed),
      clientNonce: Buffer.alloc(32, 29).toString("base64url"),
      cutIndex: 0,
      reversalMode: "upright_only",
    });
    expect(draw.assignments.every(({ orientation }) => orientation === "upright")).toBe(true);
  });

  it("rejects a seed that does not match the commitment", () => {
    const committed = Buffer.alloc(32, 31).toString("base64url");
    expect(() =>
      finalizeCommittedDraw({
        cards,
        deckVersion: "test-deck-v1",
        spread,
        sessionId: "reading-bad-commitment",
        serverSeed: Buffer.alloc(32, 32).toString("base64url"),
        serverSeedCommitment: commitDrawServerSeed(committed),
        clientNonce: Buffer.alloc(32, 33).toString("base64url"),
        cutIndex: 0,
        reversalMode: "reversals_enabled",
      }),
    ).toThrow(/commitment/i);
  });
});
