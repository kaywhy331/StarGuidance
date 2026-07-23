import { describe, expect, it } from "vitest";
import type { OracleStreamEvent } from "@starguidance/contracts";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import {
  classifyQuestion,
  createOracleStreamEvents,
  DeterministicFallbackProvider,
  PersistedResultStreamAdapter,
  selectReadingLens,
  ValidatingProvider,
} from "../src";

const draw = createLockedDraw({
  cards: tarotCards,
  deckVersion: DECK_VERSION,
  spread: spreads[0]!,
});

describe("AI boundary", () => {
  it("selects a small stable question-relevant lens without exposing raw calculations", () => {
    const lens = selectReadingLens("What should I consider in my career?", [
      {
        domain: "relationshipNeeds",
        statement: "relationship trait",
        sourceSystem: "numerology",
        sourceRule: "test.relationship",
        calculationVersion: "test-v1",
        stability: "stable",
      },
      {
        domain: "workStyle",
        statement: "work trait",
        sourceSystem: "numerology",
        sourceRule: "test.work",
        calculationVersion: "test-v1",
        stability: "stable",
      },
      {
        domain: "creativeExpression",
        statement: "uncertain trait",
        sourceSystem: "dreamspell",
        sourceRule: "test.uncertain",
        calculationVersion: "test-v1",
        stability: "uncertain",
      },
    ]);
    expect(lens.statements[0]).toBe("work trait");
    expect(lens.statements).not.toContain("uncertain trait");
  });
  it("interrupts crisis and compulsive rereading language", () => {
    expect(classifyQuestion("I want to kill myself").interrupt).toBe(true);
    expect(classifyQuestion("Can I keep redrawing the same question again?").category).toBe(
      "compulsiveReading",
    );
  });
  it("reframes high-stakes and private third-party claims", () => {
    expect(classifyQuestion("Should I buy this crypto?").category).toBe("financial");
    expect(classifyQuestion("Is she cheating?").category).toBe("infidelity");
  });
  it("returns a schema-valid deterministic fallback from the same draw", async () => {
    const result = await new DeterministicFallbackProvider().generate({
      draw,
      question: "What should I focus on?",
      relevantTraitStatements: [],
    });
    expect(result.cards[0]?.cardId).toBe(draw.assignments[0]?.cardId);
    expect(result.uncertainty).toMatch(/not factual proof/i);
  });
  it("rejects invalid provider output", async () => {
    const provider = new ValidatingProvider({
      id: "invalid",
      generate: async () => ({ arbitrary: "html" }),
    });
    await expect(
      provider.generate({ draw, question: "General", relevantTraitStatements: [] }),
    ).rejects.toThrow();
  });
  it("streams a persisted result in all required oracle phases", async () => {
    const result = await new DeterministicFallbackProvider().generate({
      draw,
      question: "What should I notice?",
      relevantTraitStatements: [],
    });
    const events = createOracleStreamEvents(result);
    expect(events[0]).toMatchObject({ phase: "openingTheme" });
    expect(events.at(-1)).toMatchObject({ phase: "uncertainty" });
    expect(
      new Set(events.map((event) => (event.type === "phase" ? event.phase : undefined))),
    ).toEqual(
      new Set([
        "openingTheme",
        "cardInterpretation",
        "overallSynthesis",
        "likelyTrajectory",
        "alternateTrajectory",
        "userAgency",
        "reflectionPrompt",
        "uncertainty",
      ]),
    );
    const streamed: OracleStreamEvent[] = [];
    for await (const event of new PersistedResultStreamAdapter().streamPersistedResult(result)) {
      streamed.push(event);
    }
    expect(streamed.at(-1)).toEqual({ type: "complete" });
  });
});
