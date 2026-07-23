import { describe, expect, it } from "vitest";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import {
  classifyQuestion,
  DeterministicFallbackProvider,
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
});
