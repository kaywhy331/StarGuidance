import { describe, expect, it } from "vitest";

import {
  casinoFanIndex,
  casinoPickTarget,
  casinoWashLayout,
  SHUFFLE_SHELL_COUNT,
} from "./shuffle-shells";

describe("casino wash possibility field", () => {
  it("accounts for all 78 cards with distinct wash destinations", () => {
    const layouts = Array.from({ length: SHUFFLE_SHELL_COUNT }, (_, index) =>
      casinoWashLayout(index),
    );
    expect(SHUFFLE_SHELL_COUNT).toBe(78);
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
