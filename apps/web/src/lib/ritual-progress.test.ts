import { describe, expect, it } from "vitest";

import { readRitualProgress, ritualSessionExpired, writeRitualProgress } from "./ritual-progress";

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
      cutIndex: 39,
      revealedIndexes: [2, 0, 2],
    });
    expect(readRitualProgress(storage, "reading-1", 3)).toEqual({
      cutIndex: 39,
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
      cutIndex: 0,
      revealedIndexes: [1],
    });
    storage.setItem("sg:reading-progress:reading-2", "not-json");
    expect(readRitualProgress(storage, "reading-2", 3)).toBeUndefined();
  });
});

describe("ritual session expiry", () => {
  const past = "2020-01-01T00:00:00.000Z";
  const future = "2099-01-01T00:00:00.000Z";

  it("never marks a reading that reached its interpretation as expired", () => {
    expect(
      ritualSessionExpired({ expiresAt: past, ritualProgress: { phase: "followUpAvailable" } }),
    ).toBe(false);
    expect(ritualSessionExpired({ expiresAt: past, ritualProgress: { phase: "complete" } })).toBe(
      false,
    );
  });

  it("marks only unfinished rituals past their window", () => {
    expect(ritualSessionExpired({ expiresAt: past, ritualProgress: { phase: "revealing" } })).toBe(
      true,
    );
    expect(ritualSessionExpired({ expiresAt: past })).toBe(true);
    expect(ritualSessionExpired({ expiresAt: future, ritualProgress: { phase: "dealing" } })).toBe(
      false,
    );
  });
});
