/** Server ritual phases in the order a reading moves through them. */
export const ritualPhaseOrder = [
  "drawLocked",
  "dealing",
  "awaitingReveal",
  "revealing",
  "fullSpreadReady",
  "interpretationStreaming",
  "followUpAvailable",
  "complete",
] as const;

export type RitualPhase = (typeof ritualPhaseOrder)[number];

export function ritualPhaseRank(phase: RitualPhase): number {
  return ritualPhaseOrder.indexOf(phase);
}

/** An unfinished ritual past its window. A reading whose interpretation was
 * reached (followUpAvailable or complete) is never "expired": it is simply a
 * kept reading. */
export function ritualSessionExpired(
  reading: { expiresAt: string; ritualProgress?: { phase: RitualPhase } | undefined },
  now = Date.now(),
): boolean {
  const phase = reading.ritualProgress?.phase;
  if (phase && ritualPhaseRank(phase) >= ritualPhaseRank("followUpAvailable")) return false;
  return now >= Date.parse(reading.expiresAt);
}

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
