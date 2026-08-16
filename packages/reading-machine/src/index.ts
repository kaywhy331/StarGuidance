import { setup } from "xstate";

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

export const readingMachine = setup({
  types: {
    events: {} as
      | { type: "START" }
      | { type: "SELECT" }
      | { type: "CHANGE_READING" }
      | { type: "QUESTION_ACCEPTED" }
      | { type: "HIGH_STAKES" }
      | { type: "DECK_READY" }
      | { type: "SHUFFLE_COMPLETE" }
      | { type: "CUT" }
      | { type: "SKIP_CUT" }
      | { type: "DEALT" }
      | { type: "REVEAL" }
      | { type: "ALL_REVEALED" }
      | { type: "GENERATION_READY" }
      | { type: "GENERATION_FAILED" }
      | { type: "RETRY_GENERATION" }
      | { type: "RESULT_REVEALED" }
      | { type: "EXPIRE" }
      | { type: "RESTART" }
      | { type: "CONTINUE_AS_REFLECTION" },
  },
}).createMachine({
  id: "reading",
  initial: "idle",
  on: { EXPIRE: ".sessionExpired" },
  states: {
    idle: { on: { START: "selectingReading" } },
    selectingReading: { on: { SELECT: "enteringQuestion" } },
    enteringQuestion: {
      on: {
        CHANGE_READING: "selectingReading",
        QUESTION_ACCEPTED: "preparingDeck",
        HIGH_STAKES: "highStakesQuestion",
      },
    },
    highStakesQuestion: {
      on: {
        CHANGE_READING: "selectingReading",
        RESTART: "enteringQuestion",
        CONTINUE_AS_REFLECTION: "preparingDeck",
      },
    },
    preparingDeck: { on: { DECK_READY: "shuffling" } },
    shuffling: { on: { SHUFFLE_COMPLETE: "cuttingDeck" } },
    cuttingDeck: {
      // This is a visual gather rather than a second user decision: the scene
      // holds here while the scattered cards return to one centered deck,
      // then advances with SKIP_CUT. Keeping the explicit state also preserves
      // persisted-flow compatibility.
      on: { CUT: "dealing", SKIP_CUT: "dealing" },
    },
    dealing: { on: { DEALT: "awaitingReveal" } },
    awaitingReveal: { on: { REVEAL: "revealingCards" } },
    revealingCards: { on: { REVEAL: "revealingCards", ALL_REVEALED: "generatingSynthesis" } },
    generatingSynthesis: {
      on: { GENERATION_READY: "revealingResult", GENERATION_FAILED: "generationFailed" },
    },
    generationFailed: { on: { RETRY_GENERATION: "generatingSynthesis" } },
    revealingResult: { on: { RESULT_REVEALED: "complete" } },
    complete: { type: "final" },
    sessionExpired: { type: "final" },
  },
});
