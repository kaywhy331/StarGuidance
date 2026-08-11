import { describe, expect, it } from "vitest";
import type { OracleStreamEvent, ProfileTrait } from "@starguidance/contracts";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import {
  classifyQuestion,
  classifyQuestionContext,
  createFollowUpStreamEvents,
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
  const trait = (
    domain: ProfileTrait["domain"],
    statement: string,
    lifeDomains: ProfileTrait["lifeDomains"],
    overrides: Partial<ProfileTrait> = {},
  ): ProfileTrait => ({
    domain,
    statement,
    sourceSystem: "numerology",
    sourceRule: `test.${domain}`,
    calculationVersion: "test-v2",
    stability: "stable",
    direction: "mixed",
    strength: 0.8,
    confidence: "high",
    lifeDomains,
    ...overrides,
  });

  it("selects only career-relevant traits and permits fewer than three", () => {
    const lens = selectReadingLens("What should I consider in my career?", [
      trait("relationshipNeeds", "relationship trait", ["relationships"]),
      trait("decisionStyle", "career decision trait", ["career", "change"]),
      trait("creativeExpression", "uncertain trait", ["career", "creativity"], {
        sourceSystem: "dreamspell",
        stability: "uncertain",
        confidence: "low",
      }),
    ]);
    expect(lens).toMatchObject({
      version: "question-trait-lens-v2",
      statements: ["career decision trait"],
      traitIndexes: [1],
    });
  });
  it.each([
    ["How can I communicate with my partner?", "relationship trait"],
    ["What can help me navigate this change?", "change trait"],
  ] as const)("selects a deterministic lens for %s", (question, expected) => {
    const lens = selectReadingLens(question, [
      trait("relationshipNeeds", "relationship trait", ["relationships"]),
      trait("stabilityVsChange", "change trait", ["change"]),
      trait("workStyle", "career trait", ["career"]),
    ]);
    expect(lens.statements).toEqual([expected]);
  });
  it("includes a relevant preserved tension without exceeding three lens statements", () => {
    const traits = [
      trait("coreMotivation", "independent momentum", ["general", "change"]),
      trait("creativeExpression", "collaborative expression", ["career", "creativity"]),
      trait("decisionStyle", "career decision trait", ["career"]),
    ];
    const lens = selectReadingLens("What should I consider in my career?", traits, [
      {
        id: "independence-vs-collaboration",
        sideA: traits[0]!.statement,
        sideB: traits[1]!.statement,
        traitIndexes: [0, 1],
        lifeDomains: ["career"],
      },
    ]);
    expect(lens.tensionIndexes).toEqual([0]);
    expect(lens.statements).toHaveLength(3);
    expect(lens.statements.at(-1)).toContain("Tension to hold:");
  });
  it("interrupts crisis and compulsive rereading language", () => {
    for (const question of [
      "I want to kill myself",
      "I don't want to be alive",
      "I think everyone would be better off dead without me",
      "I wish I were dead",
      "I have no reason to live",
      "I'm planning to overdose",
      "I might self-harm tonight",
      "I want to take my own life",
    ]) {
      const safety = classifyQuestion(question);
      expect(safety.category, question).toBe("selfHarmCrisis");
      expect(safety.interrupt, question).toBe(true);
      expect(safety.guidance, question).toMatch(/you/i);
    }
    expect(classifyQuestion("Can I keep redrawing the same question again?").category).toBe(
      "compulsiveReading",
    );
  });
  it("reframes high-stakes and private third-party claims", () => {
    expect(classifyQuestion("Should I buy this crypto?").category).toBe("financial");
    expect(classifyQuestion("Is she cheating?").category).toBe("infidelity");
  });
  it("classifies topic, intent, and horizon separately from safety", () => {
    expect(
      classifyQuestionContext("Should I prepare to take a new role at work?", {
        topic: "general",
        horizon: "months",
        generalReading: false,
      }),
    ).toEqual({
      version: "question-classification-v1",
      topic: "career",
      horizon: "months",
      intent: "decisionSupport",
      generalReading: false,
    });
    expect(
      classifyQuestionContext("", {
        topic: "general",
        horizon: "open",
        generalReading: true,
      }),
    ).toMatchObject({ topic: "general", intent: "generalReflection", generalReading: true });
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
    expect(events[0]).toMatchObject({ phase: "openingTheme", heading: result.title });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ heading: "From the Stars" }),
        expect.objectContaining({ heading: "Fated Path" }),
        expect.objectContaining({ heading: "Divergent Path" }),
        expect.objectContaining({ heading: "Cosmic Alignment" }),
        expect.objectContaining({ heading: "Starlit Reflection" }),
      ]),
    );
    // The reading no longer ends on a disclaimer: the standing statement about
    // what tarot is lives in the site terms, linked from every page, so the
    // reading can close on the reflection it offers.
    expect(events.at(-1)).toMatchObject({ phase: "reflectionPrompt" });
    expect(events.some((event) => event.type === "phase" && event.phase === "uncertainty")).toBe(
      false,
    );
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
      ]),
    );
    const streamed: OracleStreamEvent[] = [];
    for await (const event of new PersistedResultStreamAdapter().streamPersistedResult(result)) {
      streamed.push(event);
    }
    expect(streamed.at(-1)).toEqual({ type: "complete" });
  });

  it("answers a follow-up in one card- and profile-aware section", async () => {
    const provider = new DeterministicFallbackProvider();
    const trait = "you regain direction by turning reflection into a concrete next step.";
    const originalResult = await provider.generate({
      draw,
      question: "What should I notice?",
      relevantTraitStatements: [trait],
    });
    const followUp = await provider.generateFollowUp({
      draw,
      question: "What do I do next?",
      relevantTraitStatements: [trait],
      originalResult,
    });
    expect(Object.keys(followUp)).toEqual(["response"]);
    expect(followUp.response).toContain(
      tarotCards.find(({ id }) => id === draw.assignments[0]!.cardId)!.name,
    );
    expect(followUp.response).toContain(trait);

    const events = createFollowUpStreamEvents(followUp);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      phase: "followUp",
      heading: "The Cards Answer",
      text: followUp.response,
    });
    const streamed: OracleStreamEvent[] = [];
    for await (const event of new PersistedResultStreamAdapter().streamPersistedFollowUp(followUp))
      streamed.push(event);
    expect(streamed).toEqual([...events, { type: "complete" }]);
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
    expect(result.directAnswer).toMatch(/isn't theirs to say/i);
  });

  it("gives each guarded category its own reframing, not one generic sentence (G3)", async () => {
    // Both fall to the "general" subject (neither contains a work/relationship/
    // change trigger word), so `voice.about` is identical for both — isolating
    // the difference below to the safety category, not incidental subject drift
    // (that's AI-004's job, above).
    const medical = await generate("What is this diagnosis?");
    const financial = await generate("Will this stock go up?");
    expect(medical.safetyFlags).toContain("medical");
    expect(financial.safetyFlags).toContain("financial");
    expect(medical.directAnswer).not.toBe(financial.directAnswer);
    expect(medical.cards[0]?.questionConnection).not.toBe(financial.cards[0]?.questionConnection);
    // Neither reframe is classifyQuestion()'s raw, category-agnostic guidance
    // string verbatim — the bug this fixed.
    const guidance = classifyQuestion("Will this stock go up?").guidance;
    expect(financial.directAnswer).not.toContain(guidance);
    expect(financial.cards[0]?.questionConnection).not.toBe(guidance);
  });

  it("rotates a guarded category's card-level reframing rather than repeating one sentence (G3)", async () => {
    const result = await generate("What is this diagnosis?");
    expect(result.safetyFlags).toContain("medical");
    const connections = result.cards.map((card) => card.questionConnection);
    expect(connections[0]).not.toBe(connections[1]);
  });
});
