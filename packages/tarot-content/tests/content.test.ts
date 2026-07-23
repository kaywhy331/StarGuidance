import { describe, expect, it } from "vitest";

import { spreads, tarotCards } from "../src";

describe("tarot content integrity", () => {
  it("contains 78 unique cards with correct arcana and suits", () => {
    expect(tarotCards).toHaveLength(78);
    expect(new Set(tarotCards.map(({ id }) => id)).size).toBe(78);
    expect(tarotCards.filter(({ arcana }) => arcana === "major")).toHaveLength(22);
    expect(tarotCards.filter(({ arcana }) => arcana === "minor")).toHaveLength(56);
    for (const suit of ["wands", "cups", "swords", "pentacles"]) {
      expect(tarotCards.filter((card) => card.suit === suit)).toHaveLength(14);
    }
  });

  it("defines four ordered spreads without duplicate positions", () => {
    expect(spreads.map(({ positions }) => positions.length)).toEqual([1, 3, 5, 7]);
    for (const spread of spreads) {
      expect(new Set(spread.positions.map(({ id }) => id)).size).toBe(spread.positions.length);
      expect(spread.positions.map(({ order }) => order)).toEqual(
        spread.positions.map((_, index) => index),
      );
    }
  });
});
