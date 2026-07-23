import { describe, expect, it } from "vitest";

import { createFollowUpLineage, createLockedDraw, retryLockedDraw, secureShuffle } from "../src";
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
}));
const spread: Spread = {
  id: "test-spread",
  name: "Test Spread",
  version: "test-v1",
  allowReversals: true,
  optionalCut: true,
  positions: [0, 1, 2].map((order) => ({
    id: `position-${order}`,
    displayName: `Position ${order}`,
    interpretiveFunction: "test",
    description: "test",
    order,
    placement: { x: order, y: 0, rotation: 0 },
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
});
