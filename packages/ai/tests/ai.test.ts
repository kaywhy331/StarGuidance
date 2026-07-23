import { describe, expect, it } from "vitest";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import { classifyQuestion, DeterministicFallbackProvider, ValidatingProvider } from "../src";

const draw = createLockedDraw({
  cards: tarotCards,
  deckVersion: DECK_VERSION,
  spread: spreads[0]!,
  profileSnapshotId: "00000000-0000-4000-8000-000000000001",
});

describe("AI boundary", () => {
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
