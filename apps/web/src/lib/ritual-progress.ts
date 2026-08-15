export interface RitualProgress {
  revealedIndexes: readonly number[];
  cutTaken: boolean;
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
    const candidate = parsed as { revealedIndexes?: unknown; cutTaken?: unknown };
    if (!Array.isArray(candidate.revealedIndexes) || typeof candidate.cutTaken !== "boolean")
      return undefined;
    const revealedIndexes = [
      ...new Set(
        candidate.revealedIndexes.filter(
          (value): value is number => Number.isInteger(value) && value >= 0 && value < cardCount,
        ),
      ),
    ].sort((a, b) => a - b);
    return { revealedIndexes, cutTaken: candidate.cutTaken };
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
        cutTaken: progress.cutTaken,
      }),
    );
  } catch {
    // A blocked session store degrades to a fresh ritual, never a changed draw.
  }
}
