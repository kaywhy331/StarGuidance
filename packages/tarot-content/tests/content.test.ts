import { describe, expect, it } from "vitest";

import {
  allSpreads,
  findSpread,
  legacySpreads,
  renderTarotFaceSvgV3,
  resolveSpreadPositions,
  selectSpreadContextTemplate,
  spreads,
  tarotCards,
} from "../src";

describe("tarot content integrity", () => {
  it("contains 78 unique cards with correct arcana and suits", () => {
    expect(tarotCards).toHaveLength(78);
    expect(new Set(tarotCards.map(({ id }) => id)).size).toBe(78);
    expect(tarotCards.filter(({ arcana }) => arcana === "major")).toHaveLength(22);
    expect(tarotCards.filter(({ arcana }) => arcana === "minor")).toHaveLength(56);
    for (const suit of ["wands", "cups", "swords", "pentacles"]) {
      expect(tarotCards.filter((card) => card.suit === suit)).toHaveLength(14);
    }
    for (const card of tarotCards) expect(card.reversalFacets?.length).toBeGreaterThan(0);
  });

  it("assigns versioned, rights-documented artwork to every card", () => {
    for (const card of tarotCards) {
      expect(card.artwork.artworkId).toContain(card.id);
      expect(card.artwork.frontAsset).toBe(`/art/tarot/v3/${card.id}.svg`);
      expect(card.artwork.backAsset).toMatch(/\.webp$/);
      expect(card.artwork.altText).toContain(card.name);
      expect(card.artwork.artistCredit).toBeTruthy();
      expect(card.artwork.license).toContain("project use authorized");
      expect(card.artwork.provenance).toContain("original");
      expect(card.artwork.artworkVersion).toBe("starguidance-celestial-gothic-v3");
    }
  });

  it("renders 78 distinct lightweight illustrated faces", () => {
    const faces = tarotCards.map((card) => renderTarotFaceSvgV3(card));
    expect(new Set(faces).size).toBe(78);
    for (const face of faces) {
      expect(face).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
      expect(Buffer.byteLength(face, "utf8")).toBeLessThan(30_000);
      expect(face).toContain('id="frame-v3"');
    }
  });

  it("defines eight selectable spreads and preserves four retired definitions", () => {
    expect(spreads.map(({ positions }) => positions.length)).toEqual([1, 3, 5, 7, 10, 7, 7, 9]);
    expect(spreads.map(({ id }) => id)).toEqual([
      "one-card",
      "three-card",
      "crossroads",
      "outlook",
      "celtic-cross",
      "horseshoe",
      "relationship",
      "nine-card-matrix",
    ]);
    expect(legacySpreads.map(({ id }) => id)).toEqual([
      "one-card",
      "three-card",
      "focus",
      "direction",
    ]);
    expect(allSpreads).toHaveLength(12);
    expect(findSpread("outlook")?.positions).toHaveLength(7);
    expect(findSpread("one-card")?.version).toBe("one-card-v3");
    expect(findSpread("one-card", "one-card-v2")?.version).toBe("one-card-v2");
    for (const spread of spreads) {
      expect(spread.capabilities).toBeDefined();
      const positionIds = new Set(spread.positions.map(({ id }) => id));
      for (const id of spread.capabilities?.trajectoryPositionIds ?? [])
        expect(positionIds.has(id)).toBe(true);
      for (const group of spread.capabilities?.alternativePositionGroups ?? [])
        for (const id of group) expect(positionIds.has(id)).toBe(true);
      for (const link of spread.capabilities?.linkedPositions ?? [])
        for (const id of link.positionIds) expect(positionIds.has(id)).toBe(true);
    }
    for (const spread of allSpreads) {
      expect(spread.purpose.length).toBeGreaterThan(20);
      expect(spread.estimatedMinutes).toBeGreaterThan(0);
      expect(spread.entitlementClass).toBe("standard");
      expect(new Set(spread.positions.map(({ id }) => id)).size).toBe(spread.positions.length);
      expect(spread.positions.map(({ order }) => order)).toEqual(
        spread.positions.map((_, index) => index),
      );
      for (const position of spread.positions) {
        expect(position.placement.column).toBeGreaterThanOrEqual(0);
        expect(position.placement.column).toBeLessThan(spread.layout.columns);
        expect(position.placement.row).toBeGreaterThanOrEqual(0);
        expect(position.placement.row).toBeLessThan(spread.layout.rows);
      }
    }
  });

  it("models the requested spatial arrangements", () => {
    const celtic = findSpread("celtic-cross")!;
    const crossing = celtic.positions[1]!;
    expect(crossing.placement).toEqual({ column: 2, row: 1, rotation: 90, layer: 1 });
    expect(celtic.positions[0]!.placement).toMatchObject({ column: 2, row: 1, layer: 0 });

    const horseshoe = findSpread("horseshoe")!;
    expect(horseshoe.layout.rows).toBe(5);
    expect(horseshoe.positions.map(({ placement }) => [placement.column, placement.row])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [2, 3],
      [2, 4],
      [3, 1],
      [4, 0],
    ]);

    const relationship = findSpread("relationship")!;
    expect(
      relationship.positions.map(({ placement }) => [placement.column, placement.row]),
    ).toEqual([
      [0, 0],
      [2, 0],
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);
  });

  it("keeps current one- and three-card positions fixed while resolving historical contexts", () => {
    const one = findSpread("one-card")!;
    expect(
      selectSpreadContextTemplate(one, {
        topic: "general",
        intent: "decisionSupport",
        generalReading: false,
      }),
    ).toBeUndefined();
    expect(
      resolveSpreadPositions(one, {
        topic: "general",
        intent: "decisionSupport",
        generalReading: false,
      })[0]?.displayName,
    ).toBe("Focus");

    const historicalOne = findSpread("one-card", "one-card-v2")!;
    expect(
      selectSpreadContextTemplate(historicalOne, {
        topic: "general",
        intent: "decisionSupport",
        generalReading: false,
      })?.id,
    ).toBe("binary-inquiry");
    expect(
      resolveSpreadPositions(historicalOne, {
        topic: "general",
        intent: "decisionSupport",
        generalReading: false,
      })[0]?.displayName,
    ).toBe("Yes / No Pivot");

    const three = findSpread("three-card")!;
    expect(three.positions.map(({ displayName }) => displayName)).toEqual([
      "Situation",
      "Challenge",
      "Direction",
    ]);
    expect(
      selectSpreadContextTemplate(three, {
        topic: "relationships",
        intent: "clarity",
        generalReading: false,
      }),
    ).toBeUndefined();

    const historicalThree = findSpread("three-card", "three-card-v2")!;
    expect(
      selectSpreadContextTemplate(historicalThree, {
        topic: "relationships",
        intent: "clarity",
        generalReading: false,
      })?.id,
    ).toBe("situational-anatomy");
  });
});
