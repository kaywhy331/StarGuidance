import { describe, expect, it } from "vitest";

import { readRitualProgress, writeRitualProgress } from "./ritual-progress";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("ritual progress", () => {
  it("round-trips the cut decision and deduplicated reveal indexes", () => {
    const storage = memoryStorage();
    writeRitualProgress(storage, "reading-1", {
      cutTaken: true,
      revealedIndexes: [2, 0, 2],
    });
    expect(readRitualProgress(storage, "reading-1", 3)).toEqual({
      cutTaken: true,
      revealedIndexes: [0, 2],
    });
  });

  it("drops out-of-range indexes and rejects malformed receipts", () => {
    const storage = memoryStorage();
    storage.setItem(
      "sg:reading-progress:reading-1",
      JSON.stringify({ cutTaken: false, revealedIndexes: [-1, 1, 8, "2"] }),
    );
    expect(readRitualProgress(storage, "reading-1", 3)).toEqual({
      cutTaken: false,
      revealedIndexes: [1],
    });
    storage.setItem("sg:reading-progress:reading-2", "not-json");
    expect(readRitualProgress(storage, "reading-2", 3)).toBeUndefined();
  });
});
