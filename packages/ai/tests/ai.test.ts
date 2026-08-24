import { describe, expect, it } from "vitest";
import type { PersonalizationMode, ReadingConfiguration } from "@starguidance/contracts";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw, type LockedDraw, type Spread } from "@starguidance/tarot-domain";

import {
  classifyFollowUpScope,
  classifyQuestion,
  classifyQuestionContext,
  createOracleStreamEvents,
  DeterministicFallbackProvider,
  reviewTarotQuestion,
} from "../src";
import { spokenCardMeaning } from "../src/card-language";

function spread(id: string): Spread {
  const value = spreads.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing spread ${id}`);
  return value;
}

function configuration(
  value: Spread,
  personalizationMode: PersonalizationMode = "pure_tarot",
): ReadingConfiguration {
  if (!value.capabilities) throw new Error("Spread capabilities are required");
  return {
    version: "reading-configuration-v1",
    reversalMode: "reversals_enabled",
    personalizationMode,
    positions: value.positions,
    capabilities: value.capabilities,
  };
}

function draw(value: Spread, reversed = false): LockedDraw {
  const locked = createLockedDraw({
    cards: tarotCards,
    deckVersion: DECK_VERSION,
    spread: value,
    id: "00000000-0000-4000-8000-000000000001",
    now: new Date("2026-08-22T12:00:00.000Z"),
    random: () => 0,
  });
  return reversed
    ? {
        ...locked,
        assignments: locked.assignments.map((assignment, index) => ({
          ...assignment,
          orientation: index === 0 ? "reversed" : assignment.orientation,
        })),
      }
    : locked;
}

async function generate(input: {
  spreadId: string;
  question: string;
  personalizationMode?: PersonalizationMode;
  traits?: readonly string[];
  reversed?: boolean;
}) {
  const selected = spread(input.spreadId);
  return new DeterministicFallbackProvider().generate({
    draw: draw(selected, input.reversed),
    configuration: configuration(selected, input.personalizationMode),
    question: input.question,
    questionClassification: classifyQuestionContext(input.question),
    relevantTraitStatements: input.traits ?? [],
  });
}

describe("question consultation rules", () => {
  it("offers but never applies user-centered reformulations", () => {
    const original = "Will they definitely choose me?";
    const review = reviewTarotQuestion(original);
    expect(review.encouragedForm).toBe(false);
    expect(review.suggestedQuestion).toMatch(/^What should I understand/);
    expect(original).toBe("Will they definitely choose me?");
  });

  it("recognizes open questions and infers their subject and horizon", () => {
    expect(reviewTarotQuestion("How can I approach my work over the next few weeks?")).toEqual({
      encouragedForm: true,
    });
    expect(
      classifyQuestionContext("How can I approach my work over the next few weeks?"),
    ).toMatchObject({
      topic: "career",
      horizon: "weeks",
      intent: "planning",
    });
    expect(
      classifyQuestionContext("What should I understand about the next step in my work?"),
    ).toMatchObject({ topic: "career", intent: "planning" });
    expect(classifyQuestionContext("Should I leave my job?")).toMatchObject({
      topic: "career",
      intent: "decisionSupport",
    });
  });

  it("interrupts crisis and compulsive redraw language", () => {
    expect(classifyQuestion("I plan to harm myself").interrupt).toBe(true);
    expect(classifyQuestion("I keep redrawing the same question again and again").category).toBe(
      "compulsiveReading",
    );
  });

  it("keeps clarifications on the same subject but routes new subjects to a new reading", () => {
    const originalQuestion = "How should I approach my work decision over the next few weeks?";
    const originalClassification = classifyQuestionContext(originalQuestion);
    expect(
      classifyFollowUpScope({
        originalQuestion,
        originalClassification,
        followUpQuestion: "What does the Direction card add about the first step?",
      }).sameReading,
    ).toBe(true);
    expect(
      classifyFollowUpScope({
        originalQuestion,
        originalClassification,
        followUpQuestion: "What is one practical way to meet that same next step?",
      }).sameReading,
    ).toBe(true);
    expect(
      classifyFollowUpScope({
        originalQuestion,
        originalClassification,
        followUpQuestion: "What about my relationship next year?",
      }).sameReading,
    ).toBe(false);
    expect(
      classifyFollowUpScope({
        originalQuestion,
        originalClassification,
        followUpQuestion: "How should I approach relocating to a new home?",
      }).sameReading,
    ).toBe(false);
  });
});

describe("spread-aware deterministic interpretation", () => {
  it("has distinct spoken meanings for every card and orientation", () => {
    const meanings = tarotCards.flatMap((card) => [
      spokenCardMeaning(card, "upright"),
      spokenCardMeaning(card, "reversed"),
    ]);
    expect(meanings).toHaveLength(156);
    expect(new Set(meanings).size).toBe(156);
    expect(meanings.join(" ")).not.toMatch(
      /blocked or internalized form|delayed or turned inward/i,
    );
  });

  it("does not fabricate trajectory, alternate path, or timing for Single Card — Focus", async () => {
    const result = await generate({
      spreadId: "one-card",
      question: "What should I understand about my current focus?",
    });
    expect(result.cards).toHaveLength(1);
    expect(result.likelyTrajectory).toBeNull();
    expect(result.alternatePath).toBeNull();
    expect(result.timing).toBeNull();
    expect(result.cards[0]).toMatchObject({ positionLabel: "Focus" });
    expect(result.cards[0]?.supportingEvidence.join(" ")).toContain("Focus");
  });

  it("connects Situation, Challenge, and Direction and makes outlook conditional", async () => {
    const result = await generate({
      spreadId: "three-card",
      question: "How should I plan my work over the next few weeks?",
    });
    expect(result.cards.map(({ positionLabel }) => positionLabel)).toEqual([
      "Situation",
      "Challenge",
      "Direction",
    ]);
    expect(result.cards.every(({ relationshipNotes }) => relationshipNotes.length > 0)).toBe(true);
    expect(result.likelyTrajectory).toContain("Under present conditions");
    expect(result.alternatePath).toBeNull();
  });

  it("answers the confirmed concern instead of collapsing it to a broad topic", async () => {
    const nextStep = await generate({
      spreadId: "three-card",
      question: "What should I understand about the next step in my work?",
    });
    const promotion = await generate({
      spreadId: "three-card",
      question: "What should I understand about the promotion?",
    });

    expect(nextStep.directAnswer).toContain("the next step in your work");
    expect(promotion.directAnswer).toContain("the promotion");
    expect(nextStep.directAnswer).not.toBe(promotion.directAnswer);
    expect(nextStep.directAnswer).not.toContain("current pattern begins with");
    expect(nextStep.synthesis).not.toContain("not separate dictionary meanings");
    expect(
      nextStep.cards.some(({ positionInterpretation }) =>
        positionInterpretation.includes("the next step in your work"),
      ),
    ).toBe(true);
  });

  it("creates an alternate path only for a structurally branching spread", async () => {
    const result = await generate({
      spreadId: "crossroads",
      question: "What should I understand about choosing between these two paths?",
    });
    expect(result.alternatePath).toContain("real branch");
    expect(
      result.cards.find(({ positionId }) => positionId === "path-a")?.relationshipNotes.join(" "),
    ).toContain("Path B");
  });

  it("uses only approved contextual reversal facets", async () => {
    const selected = spread("one-card");
    const locked = draw(selected, true);
    const card = tarotCards.find(({ id }) => id === locked.assignments[0]?.cardId);
    const result = await generate({
      spreadId: "one-card",
      question: "What should I understand about this delay?",
      reversed: true,
    });
    expect(result.cards[0]?.orientation).toBe("reversed");
    expect(
      (card?.reversalFacets ?? []).some((facet) => result.cards[0]?.coreMeaning.includes(facet)),
    ).toBe(true);
    expect(result.cards[0]?.positionInterpretation).toContain("needs correction");
    expect(result.cards[0]?.positionInterpretation).not.toContain("automatic opposite");
  });

  it("sends no lens into Pure Tarot and labels minimized personalization separately", async () => {
    const traits = ["you prefer reversible experiments before permanent commitments"];
    const pure = await generate({
      spreadId: "one-card",
      question: "What should I understand now?",
      personalizationMode: "pure_tarot",
      traits,
    });
    const personalized = await generate({
      spreadId: "one-card",
      question: "What should I understand now?",
      personalizationMode: "personalized_tarot",
      traits,
    });
    expect(pure.personalizationLens).toBeNull();
    expect(personalized.personalizationLens?.label).toBe("Personalized reflection");
    expect(personalized.personalizationLens?.observations.join(" ")).toContain(
      "private reflection lens",
    );
  });

  it("streams only the sections the spread-aware result actually contains", async () => {
    const result = await generate({
      spreadId: "one-card",
      question: "What should I understand now?",
    });
    const phases = createOracleStreamEvents(result).filter((event) => event.type === "phase");
    expect(phases.some(({ phase }) => phase === "alternatePath")).toBe(false);
    expect(phases.some(({ phase }) => phase === "likelyTrajectory")).toBe(false);
    expect(phases.some(({ phase }) => phase === "cardInterpretation")).toBe(true);
  });

  it("does not repeat evidence-drawer glossary copy in the spoken card passage", async () => {
    const result = await generate({
      spreadId: "three-card",
      question: "How should I approach the next step in my work?",
    });
    const card = result.cards[0]!;
    const event = createOracleStreamEvents(result).find(
      (candidate) => candidate.type === "phase" && candidate.phase === "cardInterpretation",
    );
    expect(event?.type).toBe("phase");
    if (event?.type !== "phase") throw new Error("Missing card interpretation event");
    expect(event.text).toBe(card.positionInterpretation);
    expect(event.text).not.toContain("approved upright themes");
    expect(event.text).not.toContain(card.relationshipNotes[0] ?? "relationship-note-not-present");
  });
});
