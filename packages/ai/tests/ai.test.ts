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

describe("readings answer the question that was asked", () => {
  const spread = spreads.find(({ id }) => id === "direction")!;
  const drawWith = (orientations: ("upright" | "reversed")[], ids: number[]) =>
    ({
      id: "draw",
      deckVersion: DECK_VERSION,
      spreadId: "direction",
      spreadVersion: spread.version,
      shuffleVersion: "secure-fisher-yates-v1",
      lockedAt: new Date(0).toISOString(),
      assignments: spread.positions.map((position, index) => ({
        positionId: position.id,
        cardId: tarotCards[ids[index]!]!.id,
        orientation: orientations[index]!,
        order: index,
      })),
    }) as never;

  const traits = [
    "you commit quickly once a direction feels right.",
    "you process conflict privately.",
    "you steady yourself through structure.",
  ];
  const generate = (
    question: string,
    orientations: ("upright" | "reversed")[] = ["upright", "upright", "upright"],
    ids = [16, 45, 17],
  ) =>
    new DeterministicFallbackProvider().generate({
      draw: drawWith(orientations, ids),
      question,
      relevantTraitStatements: traits,
    });

  it("names the position that carries the answer, before elaborating (AI-007)", async () => {
    const result = await generate("Should I take the new role at work?");
    expect(result.directAnswer).toContain("Direction");
    expect(result.title).toContain("Direction");
  });

  it("changes the answer when the question changes, on the identical draw (AI-004)", async () => {
    const work = await generate("Should I take the new role at work?");
    const love = await generate("How do I repair things with my partner?");
    expect(work.directAnswer).not.toBe(love.directAnswer);
    expect(work.directAnswer).toContain("work");
    expect(love.directAnswer).toContain("relationship");
  });

  it("gives every card its position's interpretive function (AI-005)", async () => {
    const result = await generate("What should I focus on at work?");
    for (const [index, position] of spread.positions.entries()) {
      const card = result.cards[index]!;
      expect(card.positionId).toBe(position.id);
      expect(card.traditionalMeaning).toContain(position.interpretiveFunction);
    }
  });

  it("changes with orientation on the identical cards", async () => {
    const upright = await generate("What should I focus on at work?", [
      "upright",
      "upright",
      "upright",
    ]);
    const reversed = await generate("What should I focus on at work?", [
      "upright",
      "upright",
      "reversed",
    ]);
    expect(upright.directAnswer).not.toBe(reversed.directAnswer);
    expect(upright.likelyTrajectory.summary).not.toBe(reversed.likelyTrajectory.summary);
  });

  it("uses a distinct profile trait for each card rather than repeating one", async () => {
    const result = await generate("What should I focus on at work?");
    const personalised = result.cards.map(({ personalizedMeaning }) => personalizedMeaning);
    expect(new Set(personalised).size).toBe(personalised.length);
    for (const [index, trait] of traits.entries()) expect(personalised[index]).toContain(trait);
  });

  it("does not reuse one sentence frame for every card", async () => {
    const result = await generate("What should I focus on at work?");
    const openings = result.cards.map(({ traditionalMeaning }) => traditionalMeaning.slice(0, 14));
    expect(new Set(openings).size).toBe(openings.length);
  });

  it("derives the trajectory and its conditions from the drawn cards (AI-011)", async () => {
    const result = await generate("Should I take the new role at work?");
    expect(result.likelyTrajectory.conditions.join(" ")).toContain("Challenge");
    expect(result.likelyTrajectory.summary).toContain(tarotCards[17]!.uprightThemes[0]!);
  });

  it("keeps future language conditional and never guarantees an outcome (AI-008)", async () => {
    const result = await generate("Will I get the promotion?");
    expect(result.likelyTrajectory.summary.toLowerCase()).toMatch(
      /if nothing shifts|under current/,
    );
    expect(JSON.stringify(result).toLowerCase()).not.toMatch(
      /\b(guaranteed|certainly will|definitely will)\b/,
    );
    expect(result.uncertainty).toMatch(/not factual proof/i);
  });

  it("never copies the raw question into the persisted reading", async () => {
    const question = "Should I confront Priya about the Barcelona contract?";
    const result = await generate(question);
    expect(JSON.stringify(result)).not.toContain("Priya");
    expect(JSON.stringify(result)).not.toContain("Barcelona");
  });

  it("reframes rather than answering a high-stakes question (AI-013)", async () => {
    const result = await generate("Is my partner cheating on me?");
    expect(result.safetyFlags).toContain("infidelity");
    expect(result.directAnswer).toMatch(/will not answer that as a matter of fact/i);
  });
});
