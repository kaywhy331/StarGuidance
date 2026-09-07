import { describe, expect, it } from "vitest";

import { flipBox, flipDelta, flipIsNoticeable } from "./stage-flip";

describe("stage flip geometry", () => {
  it("derives a box from its viewport rectangle", () => {
    const box = flipBox({ left: 100, top: 50, width: 200, height: 120 } as DOMRect);
    expect(box).toEqual({ centerX: 200, centerY: 110, width: 200 });
  });

  it("computes the transform that makes the new layout look like the old one", () => {
    const before = { centerX: 400, centerY: 300, width: 600 };
    const after = { centerX: 400, centerY: 180, width: 300 };
    expect(flipDelta(before, after)).toEqual({ x: 0, y: 120, scale: 2 });
  });

  it("never scales by a degenerate width", () => {
    expect(
      flipDelta({ centerX: 0, centerY: 0, width: 0 }, { centerX: 0, centerY: 0, width: 10 }),
    ).toMatchObject({ scale: 1 });
    expect(
      flipDelta({ centerX: 0, centerY: 0, width: 10 }, { centerX: 0, centerY: 0, width: 0 }),
    ).toMatchObject({ scale: 1 });
  });

  it("ignores sub-pixel layout noise", () => {
    expect(flipIsNoticeable({ x: 0.2, y: -0.3, scale: 1.001 })).toBe(false);
    expect(flipIsNoticeable({ x: 0, y: 4, scale: 1 })).toBe(true);
    expect(flipIsNoticeable({ x: 0, y: 0, scale: 0.8 })).toBe(true);
  });
});
