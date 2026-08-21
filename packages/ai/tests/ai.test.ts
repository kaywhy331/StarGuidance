import { describe, expect, it } from "vitest";
import type { OracleStreamEvent, ProfileTrait, ReadingTopic } from "@starguidance/contracts";
import {
  DECK_VERSION,
  resolveSpreadPositions,
  spreads,
  tarotCards,
} from "@starguidance/tarot-content";
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

const questionClassification = (question: string, topic: ReadingTopic = "general") =>
  classifyQuestionContext(question, {
    topic,
    horizon: "open",
    generalReading: false,
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
  it("uses the selected topic for the profile lens when the question is ambiguous", () => {
    const lens = selectReadingLens(
      "What should I understand about this?",
      [
        trait("workStyle", "career trait", ["career"]),
        trait("relationshipNeeds", "relationship trait", ["relationships"]),
      ],
      [],
      "relationships",
    );
    expect(lens.statements).toEqual(["relationship trait"]);
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
      "I want to die",
      "I need to die",
      "I wish I could die",
      "I feel like dying",
      "I can't go on",
      "I don't want to exist",
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
    expect(
      classifyQuestionContext("What should I do about this situation at work?", {
        topic: "relationships",
        horizon: "open",
        generalReading: false,
      }).topic,
    ).toBe("relationships");
  });
  it("returns a schema-valid deterministic fallback from the same draw", async () => {
    const result = await new DeterministicFallbackProvider().generate({
      draw,
      question: "What should I focus on?",
      questionClassification: questionClassification("What should I focus on?"),
      relevantTraitStatements: [],
    });
    expect(result.cards[0]?.cardId).toBe(draw.assignments[0]?.cardId);
    expect(result.uncertainty).toMatch(/not factual proof/i);
  });
  it("narrates the Four of Pentacles as a developing life pattern, not a card report", async () => {
    const spread = spreads.find(({ id }) => id === "one-card")!;
    const card = tarotCards.find(({ id }) => id === "pentacles-four")!;
    const result = await new DeterministicFallbackProvider().generate({
      draw: {
        id: "four-of-pentacles-reading",
        deckVersion: DECK_VERSION,
        spreadId: spread.id,
        spreadVersion: spread.version,
        shuffleVersion: "secure-fisher-yates-v1",
        lockedAt: new Date(0).toISOString(),
        assignments: [
          {
            positionId: spread.positions[0]!.id,
            cardId: card.id,
            orientation: "upright",
            order: 0,
          },
        ],
      },
      question: "How is my work likely to develop?",
      questionClassification: questionClassification("How is my work likely to develop?", "career"),
      relevantTraitStatements: [
        "you tend to regain momentum through self-directed action and tangible movement.",
      ],
    });
    const narration = result.passages.map(({ text }) => text).join(" ");
    expect(result.passages[0]?.text).toMatch(
      /^The Four of Pentacles feels like .*stability is going to matter more than expansion/i,
    );
    expect(narration).toContain(
      "you tend to regain momentum through self-directed action and tangible movement",
    );
    expect(narration).toMatch(
      /I think you're going to notice|You may notice|I wouldn't be surprised/i,
    );
    expect(narration).toMatch(/turning point/i);
    expect(narration).not.toMatch(
      /Traditional current|Your personal lens|Connection to your question|This card represents/i,
    );
    expect(result.cards[0]).toMatchObject({
      positionId: "card-1",
      cardId: "pentacles-four",
      orientation: "upright",
    });
  });
  it("treats a one-card yes/no context as qualitative resistance, never a guaranteed answer", async () => {
    const spread = spreads.find(({ id }) => id === "one-card")!;
    const card = tarotCards.find(({ id }) => id === "pentacles-four")!;
    const result = await new DeterministicFallbackProvider().generate({
      draw: {
        id: "qualitative-pivot-reading",
        deckVersion: DECK_VERSION,
        spreadId: spread.id,
        spreadVersion: spread.version,
        shuffleVersion: "secure-fisher-yates-v1",
        lockedAt: new Date(0).toISOString(),
        assignments: [
          {
            positionId: spread.positions[0]!.id,
            cardId: card.id,
            orientation: "reversed",
            order: 0,
          },
        ],
      },
      question: "Should I accept the offer?",
      questionClassification: classifyQuestionContext("Should I accept the offer?", {
        topic: "career",
        horizon: "weeks",
        generalReading: false,
      }),
      relevantTraitStatements: [],
    });
    expect(result.passages[0]?.text).toMatch(
      /obstructed or premature rather than like a clean no/i,
    );
    expect(JSON.stringify(result)).not.toMatch(/guaranteed (yes|no)/i);
  });
  it("rejects invalid provider output", async () => {
    const provider = new ValidatingProvider({
      id: "invalid",
      generate: async () => ({ arbitrary: "html" }),
    });
    await expect(
      provider.generate({
        draw,
        question: "General",
        questionClassification: questionClassification("General"),
        relevantTraitStatements: [],
      }),
    ).rejects.toThrow();
  });
  it("streams a persisted result in all required oracle phases", async () => {
    const result = await new DeterministicFallbackProvider().generate({
      draw,
      question: "What should I notice?",
      questionClassification: questionClassification("What should I notice?"),
      relevantTraitStatements: [],
    });
    const events = createOracleStreamEvents(result);
    expect(events[0]).toMatchObject({ phase: "narration", heading: result.title });
    expect(events).toHaveLength(result.passages.length);
    expect(events.map((event) => (event.type === "phase" ? event.text : ""))).toEqual(
      result.passages.map(({ text }) => text),
    );
    // The reading no longer ends on a disclaimer: the standing statement about
    // what tarot is lives in the site terms, linked from every page, so the
    // reading can close on the reflection it offers.
    expect(events.at(-1)).toMatchObject({ phase: "narration" });
    expect(events.some((event) => event.type === "phase" && event.phase === "uncertainty")).toBe(
      false,
    );
    expect(
      new Set(events.map((event) => (event.type === "phase" ? event.phase : undefined))),
    ).toEqual(new Set(["narration"]));
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
      questionClassification: questionClassification("What should I notice?"),
      relevantTraitStatements: [trait],
    });
    const followUp = await provider.generateFollowUp({
      draw,
      question: "What do I do next?",
      questionClassification: questionClassification("What should I notice?"),
      relevantTraitStatements: [trait],
      originalResult,
    });
    expect(Object.keys(followUp)).toEqual(["response"]);
    expect(followUp.response).toContain(
      tarotCards.find(({ id }) => id === draw.assignments[0]!.cardId)!.name,
    );
    expect(followUp.response).toContain(trait.replace(/[.?!]+$/, ""));

    const withProvenance = await provider.generateFollowUpWithProvenance({
      draw,
      question: "What do I do next?",
      questionClassification: questionClassification("What should I notice?"),
      relevantTraitStatements: [trait],
      originalResult,
    });
    expect(withProvenance.provenance).toEqual({
      providerId: "deterministic-fallback-v1",
      promptVersion: "deterministic-fallback-v3",
      schemaVersion: "follow-up-result-v1",
    });

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
  const spread = spreads.find(({ id }) => id === "three-card")!;
  const drawWith = (orientations: ("upright" | "reversed")[], ids: number[]) =>
    ({
      id: "draw",
      deckVersion: DECK_VERSION,
      spreadId: "three-card",
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
      questionClassification: questionClassification(question),
      relevantTraitStatements: traits,
    });
  const spoken = (result: Awaited<ReturnType<typeof generate>>) =>
    result.passages.map(({ text }) => text).join(" ");

  it("keeps an explicitly selected relationship topic authoritative", async () => {
    const question = "What should I understand about this new phase at work?";
    const result = await new DeterministicFallbackProvider().generate({
      draw: drawWith(["upright", "upright", "upright"], [16, 45, 17]),
      question,
      questionClassification: questionClassification(question, "relationships"),
      relevantTraitStatements: traits,
    });
    expect(spoken(result)).toContain("connection");
    expect(spoken(result)).not.toContain("structure around your work");
  });

  it("opens with the answer-bearing card without turning the position into a heading (AI-007)", async () => {
    const result = await generate("Should I take the new role at work?");
    expect(result.passages[0]?.cardReferences).toEqual(["card-3"]);
    expect(result.passages[0]?.text).toContain(tarotCards[17]!.name);
    expect(result.passages[0]?.text).not.toContain("Decision Pivot");
  });

  it("changes the answer when the question changes, on the identical draw (AI-004)", async () => {
    const work = await generate("Should I take the new role at work?");
    const love = await generate("How do I repair things with my partner?");
    expect(spoken(work)).not.toBe(spoken(love));
    expect(spoken(work)).toContain("work");
    expect(spoken(love)).toContain("connection");
  });

  it("carries every card's positional interpretation in natural passages (AI-005)", async () => {
    const question = "What should I focus on at work?";
    const classification = questionClassification(question);
    const result = await generate(question);
    const contextualPositions = resolveSpreadPositions(spread, classification);
    for (const [index, position] of contextualPositions.entries()) {
      const card = result.cards[index]!;
      expect(card.positionId).toBe(spread.positions[index]!.id);
      const passages = result.passages.filter(({ id }) => card.passageIds.includes(id));
      expect(passages.some(({ text }) => text.includes(position.interpretiveFunction))).toBe(true);
      expect(passages.some(({ text }) => text.includes(position.displayName))).toBe(false);
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
    expect(spoken(upright)).not.toBe(spoken(reversed));
    expect(
      upright.passages.find(({ id }) => id === upright.trajectory.likelyPassageId)?.text,
    ).not.toBe(
      reversed.passages.find(({ id }) => id === reversed.trajectory.likelyPassageId)?.text,
    );
  });

  it("silently integrates profile context without announcing a personal lens", async () => {
    const result = await generate("What should I focus on at work?");
    expect(spoken(result)).toContain(traits[0]!.replace(/[.?!]+$/, ""));
    expect(spoken(result)).not.toMatch(/your (personal )?lens|based on your profile/i);
  });

  it("derives the trajectory and its conditions from the drawn cards (AI-011)", async () => {
    const result = await generate("Should I take the new role at work?");
    expect(result.trajectory.conditions.join(" ")).toContain("Decision Pivot");
    expect(
      result.passages.find(({ id }) => id === result.trajectory.likelyPassageId)?.text,
    ).toContain(tarotCards[17]!.uprightThemes[0]!);
  });

  it("keeps future language conditional and never guarantees an outcome (AI-008)", async () => {
    const result = await generate("Will I get the promotion?");
    expect(spoken(result).toLowerCase()).toMatch(/if the current|from where things stand/);
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
    expect(spoken(result)).toMatch(/isn't theirs to say/i);
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
    expect(medical.passages[0]?.text).not.toBe(financial.passages[0]?.text);
    // Neither reframe is classifyQuestion()'s raw, category-agnostic guidance
    // string verbatim — the bug this fixed.
    const guidance = classifyQuestion("Will this stock go up?").guidance;
    expect(financial.passages[0]?.text).not.toContain(guidance);
  });

  it("keeps guarded narration varied and grounded in observable actions (G3)", async () => {
    const result = await generate("What is this diagnosis?");
    expect(result.safetyFlags).toContain("medical");
    const threads = result.passages.filter(({ id }) => id.startsWith("thread-"));
    expect(new Set(threads.map(({ text }) => text)).size).toBe(threads.length);
    expect(spoken(result)).toContain("qualified conversation");
  });
});
