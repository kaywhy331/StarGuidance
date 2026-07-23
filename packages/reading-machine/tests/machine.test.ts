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

  it("interrupts high-stakes questions before deck preparation", () => {
    const actor = createActor(readingMachine).start();
    actor.send({ type: "START" });
    actor.send({ type: "SELECT" });
    actor.send({ type: "HIGH_STAKES" });
    expect(actor.getSnapshot().value).toBe("highStakesQuestion");
  });
});
