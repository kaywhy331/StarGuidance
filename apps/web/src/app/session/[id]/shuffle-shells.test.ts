import { describe, expect, it } from "vitest";

import {
  CASINO_PICK_SCALE,
  casinoFanIndex,
  casinoPickTarget,
  casinoWashLayout,
  fieldTargetsForSlots,
  SHUFFLE_SHELL_COUNT,
  spreadLayoutFor,
  TAROT_DECK_SIZE,
} from "./shuffle-shells";

describe("casino wash possibility field", () => {
  it("accounts for all 78 cards with distinct wash destinations", () => {
    const layouts = Array.from({ length: TAROT_DECK_SIZE }, (_, index) => casinoWashLayout(index));
    expect(TAROT_DECK_SIZE).toBe(78);
    expect(SHUFFLE_SHELL_COUNT).toBeLessThanOrEqual(12);
    expect(
      new Set(layouts.map(({ washAX, washAY }) => `${washAX.toFixed(4)}:${washAY.toFixed(4)}`)),
    ).toHaveLength(78);
  });

  it("changes presentation coordinates when the person stirs again", () => {
    expect(casinoWashLayout(12, 1)).not.toEqual(casinoWashLayout(12, 0));
  });

  it("fans from lower left to lower right in a slight arch", () => {
    const left = casinoWashLayout(0);
    const middle = casinoWashLayout(39);
    const right = casinoWashLayout(77);
    expect(left.fanLeft).toBeLessThan(middle.fanLeft);
    expect(middle.fanLeft).toBeLessThan(right.fanLeft);
    expect(middle.fanBottom).toBeGreaterThan(left.fanBottom);
    expect(middle.fanBottom).toBeGreaterThan(right.fanBottom);
  });

  it("maps picked cards into their reading positions", () => {
    const positions = [0, 1, 2].map((column) => ({
      id: `card-${column}`,
      displayName: `Card ${column + 1}`,
      order: column,
      placement: { column, row: 0, rotation: 0, layer: 0 },
    }));
    expect(positions.map((position) => casinoPickTarget(position, positions).left)).toEqual([
      35, 50, 65,
    ]);
  });

  it("maps the full fan hit surface to every hidden deck index", () => {
    expect(casinoFanIndex(40, 40, 920)).toBe(0);
    expect(casinoFanIndex(500, 40, 920)).toBe(39);
    expect(casinoFanIndex(960, 40, 920)).toBe(77);
    expect(() => casinoFanIndex(40, 40, 0)).toThrow(RangeError);
  });

  it("rejects indexes outside the complete deck", () => {
    expect(() => casinoWashLayout(-1)).toThrow(RangeError);
    expect(() => casinoWashLayout(78)).toThrow(RangeError);
  });
});

describe("spread slot targeting", () => {
  const positions = [
    {
      id: "a",
      displayName: "A",
      order: 0,
      placement: { column: 0, row: 0, rotation: 0, layer: 0 },
    },
    {
      id: "b",
      displayName: "B",
      order: 1,
      placement: { column: 2, row: 4, rotation: 90, layer: 1 },
    },
  ];

  it("derives the dealt grid from the ceremony", () => {
    expect(spreadLayoutFor({ id: "horseshoe", version: "horseshoe-v3", positions })).toEqual({
      columns: 3,
      rows: 5,
      kind: "horseshoe",
    });
    expect(spreadLayoutFor({ id: "single", version: "v1", positions: [positions[0]!] })).toEqual({
      columns: 1,
      rows: 1,
      kind: "centered",
    });
  });

  it("maps measured slots to field-relative anchors that center the picked shell", () => {
    const field = { left: 100, bottom: 700, width: 1000, height: 600 };
    const slots = [
      { positionId: "a", centerX: 350, centerY: 300, width: 80, height: 120 },
      { positionId: "b", centerX: 600, centerY: 460, width: 80, height: 120 },
    ];
    const targets = fieldTargetsForSlots(slots, positions, field, 60)!;
    expect(targets["a"]!.left).toBeCloseTo(25);
    expect(targets["b"]!.left).toBeCloseTo(50);
    expect(targets["b"]!.rotation).toBe(90);
    // Shell bottom edge sits half a shell (less the scale lift) below the slot center.
    const lift = (CASINO_PICK_SCALE - 1) * 60 * 0.42;
    expect(targets["a"]!.bottom).toBeCloseTo(((700 - (300 + 30 - lift)) / 600) * 100);
  });

  it("falls back when a slot or the field is missing", () => {
    expect(
      fieldTargetsForSlots([], positions, { left: 0, bottom: 1, width: 1, height: 1 }, 1),
    ).toBe(undefined);
    expect(
      fieldTargetsForSlots([], positions, { left: 0, bottom: 0, width: 0, height: 0 }, 1),
    ).toBe(undefined);
  });
});
