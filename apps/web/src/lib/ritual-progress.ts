export interface RitualProgress {
  revealedIndexes: readonly number[];
  cutIndex: number;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function key(readingId: string) {
  return `sg:reading-progress:${readingId}`;
}

export function readRitualProgress(
  storage: SessionStorageLike,
  readingId: string,
  cardCount: number,
): RitualProgress | undefined {
  try {
    const parsed = JSON.parse(storage.getItem(key(readingId)) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const candidate = parsed as {
      revealedIndexes?: unknown;
      cutIndex?: unknown;
      cutTaken?: unknown;
    };
    if (!Array.isArray(candidate.revealedIndexes)) return undefined;
    const historicalCut = candidate.cutTaken === true ? 39 : 0;
    const cutIndex =
      typeof candidate.cutIndex === "number" &&
      Number.isInteger(candidate.cutIndex) &&
      candidate.cutIndex >= 0 &&
      candidate.cutIndex <= 77
        ? candidate.cutIndex
        : historicalCut;
    const revealedIndexes = [
      ...new Set(
        candidate.revealedIndexes.filter(
          (value): value is number => Number.isInteger(value) && value >= 0 && value < cardCount,
        ),
      ),
    ].sort((a, b) => a - b);
    return { revealedIndexes, cutIndex };
  } catch {
    return undefined;
  }
}

export function writeRitualProgress(
  storage: SessionStorageLike,
  readingId: string,
  progress: RitualProgress,
) {
  try {
    storage.setItem(
      key(readingId),
      JSON.stringify({
        revealedIndexes: [...new Set(progress.revealedIndexes)].sort((a, b) => a - b),
        cutIndex: progress.cutIndex,
      }),
    );
  } catch {
    // A blocked session store degrades to server recovery, never a changed draw.
  }
}
