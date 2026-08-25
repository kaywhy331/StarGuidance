import { describe, expect, it } from "vitest";

import {
  cutIndexFromRatio,
  SHUFFLE_SHELL_COUNT,
  SHUFFLE_STREAM_COUNT,
  shuffleShellLayout,
} from "./shuffle-shells";

describe("full-deck possibility field", () => {
  it("accounts for all 78 anonymous card backs in six planar streams", () => {
    const layouts = Array.from({ length: SHUFFLE_SHELL_COUNT }, (_, index) =>
      shuffleShellLayout(index),
    );

    expect(SHUFFLE_SHELL_COUNT).toBe(78);
    expect(new Set(layouts.map(({ stream }) => stream))).toHaveLength(SHUFFLE_STREAM_COUNT);
    for (let stream = 0; stream < SHUFFLE_STREAM_COUNT; stream += 1) {
      expect(layouts.filter((layout) => layout.stream === stream)).toHaveLength(13);
    }
  });

  it("gives every shell a distinct planar field and weave destination", () => {
    const layouts = Array.from({ length: SHUFFLE_SHELL_COUNT }, (_, index) =>
      shuffleShellLayout(index),
    );
    const coordinateKey = (x: number, y: number) => `${x.toFixed(4)}:${y.toFixed(4)}`;

    expect(
      new Set(layouts.map(({ fieldX, fieldY }) => coordinateKey(fieldX, fieldY))),
    ).toHaveLength(SHUFFLE_SHELL_COUNT);
    expect(
      new Set(layouts.map(({ weaveX, weaveY }) => coordinateKey(weaveX, weaveY))),
    ).toHaveLength(SHUFFLE_SHELL_COUNT);
  });

  it("rejects indexes outside the complete deck", () => {
    expect(() => shuffleShellLayout(-1)).toThrow(RangeError);
    expect(() => shuffleShellLayout(78)).toThrow(RangeError);
  });
});

describe("immersive deck cut", () => {
  it("maps the touched deck depth to an exact, non-empty cut", () => {
    expect(cutIndexFromRatio(0)).toBe(1);
    expect(cutIndexFromRatio(0.25)).toBe(20);
    expect(cutIndexFromRatio(0.5)).toBe(39);
    expect(cutIndexFromRatio(58 / 78)).toBe(58);
    expect(cutIndexFromRatio(1)).toBe(77);
  });

  it("clamps invalid and out-of-range pointer positions", () => {
    expect(cutIndexFromRatio(-4)).toBe(1);
    expect(cutIndexFromRatio(4)).toBe(77);
    expect(cutIndexFromRatio(Number.NaN)).toBe(39);
  });
});
