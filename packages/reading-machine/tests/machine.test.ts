import { createActor } from "xstate";
import { describe, expect, it } from "vitest";

import { readingMachine } from "../src";

describe("reading state machine", () => {
  it("rejects invalid transitions", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "DEALT" });
    expect(actor.getSnapshot().value).toBe("idle");
  });

  it("routes generation failure to same-session retry", () => {
    const actor = createActor(readingMachine).start();
    for (const event of [
      { type: "START" },
      { type: "SELECT" },
      { type: "QUESTION_ACCEPTED" },
      { type: "DECK_READY" },
      { type: "SHUFFLE_COMPLETE" },
      { type: "SKIP_CUT" },
      { type: "DEALT" },
      { type: "REVEAL" },
      { type: "ALL_REVEALED" },
      { type: "GENERATION_FAILED" },
      { type: "RETRY_GENERATION" },
    ] as const)
      actor.send(event);
    expect(actor.getSnapshot().value).toBe("generatingSynthesis");
  });

  it("holds in the gather phase before dealing", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SELECT" });
    actor.send({ type: "QUESTION_ACCEPTED" });
    actor.send({ type: "DECK_READY" });
    actor.send({ type: "SHUFFLE_COMPLETE" });
    expect(actor.getSnapshot().value).toBe("cuttingDeck");
    actor.send({ type: "SKIP_CUT" });
    expect(actor.getSnapshot().value).toBe("dealing");
  });

  it("interrupts high-stakes questions before deck preparation", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SELECT" });
    actor.send({ type: "HIGH_STAKES" });
    expect(actor.getSnapshot().value).toBe("highStakesQuestion");
  });

  it("restarts a high-stakes question back to the question step", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SELECT" });
    actor.send({ type: "HIGH_STAKES" });
    actor.send({ type: "RESTART" });
    expect(actor.getSnapshot().value).toBe("enteringQuestion");
  });

  it("returns from question entry to reading selection", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SELECT" });
    actor.send({ type: "CHANGE_READING" });
    expect(actor.getSnapshot().value).toBe("selectingReading");
  });

  it("continues a high-stakes question only after acknowledged deck preparation", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SELECT" });
    actor.send({ type: "HIGH_STAKES" });
    actor.send({ type: "CONTINUE_AS_REFLECTION" });
    expect(actor.getSnapshot().value).toBe("preparingDeck");
    actor.send({ type: "DECK_READY" });
    expect(actor.getSnapshot().value).toBe("shuffling");
  });
});
