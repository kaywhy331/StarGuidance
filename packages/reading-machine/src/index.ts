import { setup } from "xstate";

/** The auditable consultation lifecycle. Card identity cannot exist before drawFinalizing. */
export const readingStateNames = [
  "idle",
  "readingCreated",
  "questionDrafting",
  "questionConfirmed",
  "spreadConfirmed",
  "safetyApproved",
  "focusing",
  "shuffling",
  "selectingCards",
  "optionalCut",
  "drawFinalizing",
  "drawLocked",
  "dealing",
  "awaitingReveal",
  "revealing",
  "fullSpreadReady",
  "interpretationStreaming",
  "followUpAvailable",
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
      | { type: "DRAFT_QUESTION" }
      | { type: "CONFIRM_QUESTION" }
      | { type: "REVISE_QUESTION" }
      | { type: "CONFIRM_SPREAD" }
      | { type: "CHANGE_SPREAD" }
      | { type: "SAFETY_APPROVED" }
      | { type: "HIGH_STAKES" }
      | { type: "CONTINUE_AS_REFLECTION" }
      | { type: "FOCUS_COMPLETE" }
      | { type: "SHUFFLE_COMPLETE" }
      | { type: "SELECTION_COMPLETE" }
      | { type: "CUT" }
      | { type: "SKIP_CUT" }
      | { type: "DRAW_LOCKED" }
      | { type: "FINALIZATION_FAILED" }
      | { type: "RESTORE_LOCKED" }
      | { type: "BEGIN_DEAL" }
      | { type: "DEALT" }
      | { type: "REVEAL" }
      | { type: "ALL_REVEALED" }
      | { type: "BEGIN_INTERPRETATION" }
      | { type: "GENERATION_FAILED" }
      | { type: "RETRY_GENERATION" }
      | { type: "INTERPRETATION_COMPLETE" }
      | { type: "COMPLETE" }
      | { type: "EXPIRE" },
  },
}).createMachine({
  id: "reading",
  initial: "idle",
  on: { EXPIRE: ".sessionExpired" },
  states: {
    idle: { on: { START: "readingCreated" } },
    readingCreated: {
      on: { DRAFT_QUESTION: "questionDrafting", RESTORE_LOCKED: "drawLocked" },
    },
    questionDrafting: { on: { CONFIRM_QUESTION: "questionConfirmed" } },
    questionConfirmed: {
      on: { CONFIRM_SPREAD: "spreadConfirmed", REVISE_QUESTION: "questionDrafting" },
    },
    spreadConfirmed: {
      on: {
        SAFETY_APPROVED: "safetyApproved",
        HIGH_STAKES: "highStakesQuestion",
        CHANGE_SPREAD: "questionConfirmed",
        REVISE_QUESTION: "questionDrafting",
      },
    },
    highStakesQuestion: {
      on: {
        CONTINUE_AS_REFLECTION: "safetyApproved",
        REVISE_QUESTION: "questionDrafting",
      },
    },
    safetyApproved: { always: "focusing" },
    focusing: { on: { FOCUS_COMPLETE: "shuffling" } },
    shuffling: { on: { SHUFFLE_COMPLETE: "selectingCards" } },
    selectingCards: { on: { SELECTION_COMPLETE: "drawFinalizing" } },
    /** Historical recovery state for ceremonies prepared by the cut-based
     * interface. New readings use selectingCards. */
    optionalCut: { on: { CUT: "drawFinalizing", SKIP_CUT: "drawFinalizing" } },
    drawFinalizing: {
      on: { DRAW_LOCKED: "drawLocked", FINALIZATION_FAILED: "selectingCards" },
    },
    drawLocked: { on: { BEGIN_DEAL: "dealing" } },
    dealing: { on: { DEALT: "awaitingReveal" } },
    awaitingReveal: { on: { REVEAL: "revealing" } },
    revealing: { on: { REVEAL: "revealing", ALL_REVEALED: "fullSpreadReady" } },
    fullSpreadReady: { on: { BEGIN_INTERPRETATION: "interpretationStreaming" } },
    interpretationStreaming: {
      on: {
        INTERPRETATION_COMPLETE: "followUpAvailable",
        GENERATION_FAILED: "generationFailed",
      },
    },
    generationFailed: { on: { RETRY_GENERATION: "interpretationStreaming" } },
    followUpAvailable: { on: { COMPLETE: "complete" } },
    complete: { type: "final" },
    sessionExpired: { type: "final" },
  },
});
