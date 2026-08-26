import { createActor, type ActorRefFrom } from "xstate";
import { describe, expect, it } from "vitest";

import { readingMachine } from "../src";

type ReadingActor = ActorRefFrom<typeof readingMachine>;

function prepareThroughSpread(actor: ReadingActor) {
  actor.send({ type: "START" });
  actor.send({ type: "DRAFT_QUESTION" });
  actor.send({ type: "CONFIRM_QUESTION" });
  actor.send({ type: "CONFIRM_SPREAD" });
}

function reachLockedDraw(actor: ReadingActor) {
  prepareThroughSpread(actor);
  actor.send({ type: "SAFETY_APPROVED" });
  actor.send({ type: "FOCUS_COMPLETE" });
  actor.send({ type: "SHUFFLE_COMPLETE" });
  actor.send({ type: "SELECTION_COMPLETE" });
  expect(actor.getSnapshot().value).toBe("drawFinalizing");
  actor.send({ type: "DRAW_LOCKED" });
}

describe("committed-draw reading lifecycle", () => {
  it("does not accept a locked draw before question, spread, shuffle, and cut completion", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "DRAW_LOCKED" });
    expect(actor.getSnapshot().value).toBe("readingCreated");
    actor.send({ type: "DRAFT_QUESTION" });
    actor.send({ type: "CONFIRM_QUESTION" });
    actor.send({ type: "CONFIRM_SPREAD" });
    actor.send({ type: "SAFETY_APPROVED" });
    actor.send({ type: "DRAW_LOCKED" });
    expect(actor.getSnapshot().value).toBe("focusing");
  });

  it("places a completed fan selection in drawFinalizing before drawLocked", () => {
    const actor = createActor(readingMachine).start();
    reachLockedDraw(actor);
    expect(actor.getSnapshot().value).toBe("drawLocked");
  });

  it("returns to card selection when atomic finalization fails", () => {
    const actor = createActor(readingMachine).start();
    prepareThroughSpread(actor);
    actor.send({ type: "SAFETY_APPROVED" });
    actor.send({ type: "FOCUS_COMPLETE" });
    actor.send({ type: "SHUFFLE_COMPLETE" });
    actor.send({ type: "SELECTION_COMPLETE" });
    actor.send({ type: "FINALIZATION_FAILED" });
    expect(actor.getSnapshot().value).toBe("selectingCards");
  });

  it("does not begin whole-spread interpretation until all cards are revealed", () => {
    const actor = createActor(readingMachine).start();
    reachLockedDraw(actor);
    actor.send({ type: "BEGIN_DEAL" });
    actor.send({ type: "DEALT" });
    actor.send({ type: "BEGIN_INTERPRETATION" });
    expect(actor.getSnapshot().value).toBe("awaitingReveal");
    actor.send({ type: "REVEAL" });
    actor.send({ type: "BEGIN_INTERPRETATION" });
    expect(actor.getSnapshot().value).toBe("revealing");
    actor.send({ type: "ALL_REVEALED" });
    expect(actor.getSnapshot().value).toBe("fullSpreadReady");
    actor.send({ type: "BEGIN_INTERPRETATION" });
    expect(actor.getSnapshot().value).toBe("interpretationStreaming");
  });

  it("retries interpretation in the same locked session", () => {
    const actor = createActor(readingMachine).start();
    reachLockedDraw(actor);
    for (const type of [
      "BEGIN_DEAL",
      "DEALT",
      "REVEAL",
      "ALL_REVEALED",
      "BEGIN_INTERPRETATION",
    ] as const)
      actor.send({ type });
    actor.send({ type: "GENERATION_FAILED" });
    expect(actor.getSnapshot().value).toBe("generationFailed");
    actor.send({ type: "RETRY_GENERATION" });
    expect(actor.getSnapshot().value).toBe("interpretationStreaming");
  });

  it("requires acknowledgement before a guarded reading reaches focus", () => {
    const actor = createActor(readingMachine).start();
    prepareThroughSpread(actor);
    actor.send({ type: "HIGH_STAKES" });
    expect(actor.getSnapshot().value).toBe("highStakesQuestion");
    actor.send({ type: "CONTINUE_AS_REFLECTION" });
    expect(actor.getSnapshot().value).toBe("focusing");
  });

  it("restores a finalized session directly to the exact locked draw", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "RESTORE_LOCKED" });
    expect(actor.getSnapshot().value).toBe("drawLocked");
  });
});
