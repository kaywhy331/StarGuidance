import { describe, expect, it } from "vitest";

import { renderTarotFaceSvg, spreads, tarotCards } from "../src";

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

  it("assigns versioned, rights-documented artwork to every card", () => {
    for (const card of tarotCards) {
      expect(card.artwork.artworkId).toContain(card.id);
      expect(card.artwork.frontAsset).toBe(`/art/tarot/v2/${card.id}.svg`);
      expect(card.artwork.backAsset).toMatch(/\.webp$/);
      expect(card.artwork.altText).toContain(card.name);
      expect(card.artwork.artistCredit).toBeTruthy();
      expect(card.artwork.license).toContain("project use authorized");
      expect(card.artwork.provenance).toContain("original");
      expect(card.artwork.artworkVersion).toBe("starguidance-celestial-gothic-v2");
    }
  });

  it("renders 78 distinct lightweight illustrated faces", () => {
    const faces = tarotCards.map((card) => renderTarotFaceSvg(card));
    expect(new Set(faces).size).toBe(78);
    for (const face of faces) {
      expect(face).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(Buffer.byteLength(face, "utf8")).toBeLessThan(25_000);
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
