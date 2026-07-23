export const readingStateNames = [
  "idle",
  "selectingReading",
  "enteringQuestion",
  "preparingDeck",
  "shuffling",
  "cuttingDeck",
  "dealing",
  "awaitingReveal",
  "revealingCards",
  "generatingSynthesis",
  "revealingResult",
  "complete",
  "generationFailed",
  "sessionExpired",
  "highStakesQuestion",
] as const;

export type ReadingStateName = (typeof readingStateNames)[number];
