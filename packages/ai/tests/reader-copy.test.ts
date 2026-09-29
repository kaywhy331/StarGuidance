import { describe, expect, it } from "vitest";
import type { ReadingConfiguration, ReadingResult } from "@starguidance/contracts";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw, type LockedDraw, type Spread } from "@starguidance/tarot-domain";

import {
  cardReference,
  cardRevealLine,
  classifyQuestion,
  classifyQuestionContext,
  createFollowUpStreamEvents,
  createOracleStreamEvents,
  DeterministicFallbackProvider,
  SAFETY_USER_MESSAGES,
  type SafetyCategory,
} from "../src";
import { generatedOutputSafetyViolation } from "../src/output-safety";

function spread(id: string): Spread {
  const value = spreads.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing spread ${id}`);
  return value;
}

function configuration(value: Spread): ReadingConfiguration {
  if (!value.capabilities) throw new Error("Spread capabilities are required");
  return {
    version: "reading-configuration-v1",
    reversalMode: "reversals_enabled",
    personalizationMode: "pure_tarot",
    positions: value.positions,
    capabilities: value.capabilities,
  };
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return (max: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
}

function seededDraw(value: Spread, seed: number): LockedDraw {
  return createLockedDraw({
    cards: tarotCards,
    deckVersion: DECK_VERSION,
    spread: value,
    id: "00000000-0000-4000-8000-000000000001",
    now: new Date("2026-08-22T12:00:00.000Z"),
    random: seededRandom(seed),
  });
}

function withCards(
  locked: LockedDraw,
  picks: readonly (readonly [string, "upright" | "reversed"])[],
): LockedDraw {
  return {
    ...locked,
    assignments: locked.assignments.map((assignment, index) => ({
      ...assignment,
      cardId: picks[index]?.[0] ?? assignment.cardId,
      orientation: picks[index]?.[1] ?? assignment.orientation,
    })),
  };
}

const provider = new DeterministicFallbackProvider();

async function reading(spreadId: string, question: string, locked?: LockedDraw, seed = 7) {
  const selected = spread(spreadId);
  const draw = locked ?? seededDraw(selected, seed);
  const input = {
    draw,
    configuration: configuration(selected),
    question,
    questionClassification: classifyQuestionContext(question),
    relevantTraitStatements: [],
  };
  const result = await provider.generate(input);
  return { input, result };
}

function readerText(result: ReadingResult): string[] {
  return createOracleStreamEvents(result).flatMap((event) =>
    event.type === "phase" ? [event.text] : [],
  );
}

function sentences(texts: readonly string[]): string[] {
  return texts
    .flatMap((text) => text.split(/(?<=[.?!])\s+/u))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => (seen.has(value) ? true : (seen.add(value), false)));
}

describe("question safety classifier", () => {
  it.each([
    "Will my ex return?",
    "What should I understand about the next sentence of my story?",
    "Will I get the job?",
    "Is my friend being honest with me?",
    "What should I focus on at work this month?",
    "I'm dying to know if he likes me",
    "Why do I feel guilty about leaving my old team?",
    "Is it time to take stock of my life?",
    "Is courting him a good idea?",
    "Should I become a doctor?",
    "Should I end things with him?",
    "Should I invest more energy in this friendship?",
    "Will the return trip go smoothly?",
    "I want to disappear for a weekend with my partner.",
    "I can't go on the trip this year, what should I do instead?",
    "What does this week hold for a Cancer like me?",
    "I don't want to go on another date with him.",
    "Should I go to medical school?",
    "Will the basketball court be finished soon?",
  ])("keeps an ordinary question ordinary: %s", (question) => {
    expect(classifyQuestion(question).category).toBe("ordinary");
  });

  it.each<[string, SafetyCategory]>([
    ["Should I buy or sell this stock?", "financial"],
    ["Will my crypto investment return a profit?", "financial"],
    ["What is the return on investment for this property?", "financial"],
    ["Will my stocks go up next month?", "financial"],
    ["Should I invest in bitcoin?", "financial"],
    ["Will I win my court case?", "legal"],
    ["Will I have to go to court?", "legal"],
    ["Will he get a prison sentence?", "legal"],
    ["Will I win custody of my kids?", "legal"],
    ["Should I hire a lawyer?", "legal"],
    ["Should I see a doctor about this symptom?", "medical"],
    ["Is my test results news bad?", "medical"],
    ["Is he guilty?", "criminalGuilt"],
    ["Is my partner cheating on me?", "infidelity"],
    ["Am I pregnant?", "pregnancy"],
    ["Is my boss a narcissist?", "mentalHealthDiagnosis"],
    ["What is he hiding from me?", "thirdPartyPrivateClaim"],
    ["I keep redrawing the same question again and again", "compulsiveReading"],
  ])("still guards %s as %s", (question, category) => {
    expect(classifyQuestion(question).category).toBe(category);
  });

  it.each([
    "I don't want to be here anymore",
    "should I overdose tonight",
    "I keep cutting myself",
    "I want to end it all",
    "is there any point in living",
    "I want to disappear forever",
    "nobody would miss me",
    "thinking about killing myself",
    "I can't go on",
    "I wish I could sleep and never wake up",
    "I plan to harm myself",
    "I feel suicidal",
    "Everyone would be better off without me",
    "Life isn't worth living",
    "I can't take it anymore",
    "I just want to die",
  ])("interrupts crisis language: %s", (question) => {
    const result = classifyQuestion(question);
    expect(result.category).toBe("selfHarmCrisis");
    expect(result.interrupt).toBe(true);
  });

  it("gives every category plain reader copy separate from model guidance", () => {
    const categories = Object.keys(SAFETY_USER_MESSAGES) as SafetyCategory[];
    expect(categories).toHaveLength(12);
    for (const message of Object.values(SAFETY_USER_MESSAGES)) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/\b(?:redraw|retain|reframe|user agency)\b/i);
    }
    const compulsive = classifyQuestion("I keep redrawing the same question again and again");
    expect(compulsive.guidance).toMatch(/Retain the prior reading/);
    expect(compulsive.userMessage).toBe(SAFETY_USER_MESSAGES.compulsiveReading);
    expect(compulsive.userMessage).not.toBe(compulsive.guidance);
    expect(classifyQuestion("Will I win my court case?").userMessage).toMatch(/lawyer/);
    expect(classifyQuestion("I want to end it all").userMessage).toMatch(/crisis lines/);
  });
});

describe("card naming", () => {
  it("never doubles or misapplies an article across all 78 cards", () => {
    expect(tarotCards).toHaveLength(78);
    for (const card of tarotCards) {
      for (const sentenceStart of [true, false]) {
        for (const reversed of [true, false]) {
          const named = cardReference(card, { sentenceStart, reversed });
          expect(named).not.toMatch(/\bthe the\b/i);
          if (card.arcana === "major") {
            expect(named.startsWith(card.name)).toBe(true);
          } else {
            expect(named).toBe(
              `${sentenceStart ? "The" : "the"} ${card.name}${reversed ? " reversed" : ""}`,
            );
          }
        }
      }
    }
    const temperance = tarotCards.find(({ name }) => name === "Temperance")!;
    expect(cardReference(temperance, { sentenceStart: true })).toBe("Temperance");
  });

  it("writes a plain reveal line for guest surfaces", () => {
    const star = tarotCards.find(({ name }) => name === "The Star")!;
    expect(cardRevealLine(star, "upright", "Present")).toBe(
      "The Star sits in your Present — hope returning in a form that is gentle, realistic, and worth tending.",
    );
    expect(cardRevealLine(star, "upright", "The Present")).toMatch(/sits in the Present/);
  });

  it("uses no misapplied articles anywhere in generated readings", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { result } = await reading(
        "celtic-cross",
        "What should I understand now?",
        undefined,
        seed,
      );
      const text = readerText(result).join(" ");
      expect(text).not.toMatch(/\bthe the\b/i);
      expect(text).not.toMatch(
        /\bthe (?:Temperance|Strength|Justice|Death|Judgement|Wheel of Fortune)\b/i,
      );
      expect(text).not.toMatch(/\bIn [A-Z][a-z]+, /);
    }
  });
});

describe("fallback reader copy", () => {
  const spreadQuestions: readonly [string, string][] = [
    ["one-card", "What should I understand about the next step in my work?"],
    ["three-card", "What should I understand about the next step in my work?"],
    ["three-card", "How can I handle the conversation with my partner?"],
    ["crossroads", "Should I choose the new role or stay?"],
    ["outlook", "What should I expect over the next few months?"],
    ["celtic-cross", "What should I understand about this change?"],
    ["horseshoe", "How can I rebuild my energy?"],
    ["relationship", "What should I understand about this relationship?"],
    ["nine-card-matrix", "What should I understand now?"],
  ];

  it("never repeats a sentence within a reading or its follow-up", async () => {
    for (const [spreadId, question] of spreadQuestions) {
      for (const seed of [11, 12, 13, 14]) {
        const { input, result } = await reading(spreadId, question, undefined, seed);
        const readingSentences = sentences(readerText(result));
        expect(duplicates(readingSentences), `${spreadId} seed ${seed}`).toEqual([]);

        const followUp = await provider.generateFollowUp({
          ...input,
          question: "What should I focus on first?",
          originalResult: result,
        });
        const followUpSentences = sentences([followUp.response]);
        expect(duplicates(followUpSentences)).toEqual([]);
        expect(followUpSentences.filter((sentence) => readingSentences.includes(sentence))).toEqual(
          [],
        );
      }
    }
  });

  it("never repeats a sentence in a guarded reading", async () => {
    for (const spreadId of ["three-card", "celtic-cross", "nine-card-matrix"]) {
      const { result } = await reading(spreadId, "Will I win my court case?");
      expect(result.safetyFlags).toEqual(["legal"]);
      expect(duplicates(sentences(readerText(result)))).toEqual([]);
    }
  });

  it("names the card in each card passage heading and drawer entry", async () => {
    const selected = spread("three-card");
    const locked = withCards(seededDraw(selected, 1), [
      ["major-02", "upright"],
      ["major-14", "reversed"],
      ["pentacles-five", "reversed"],
    ]);
    const { result } = await reading(
      "three-card",
      "What should I understand about the next step in my work?",
      locked,
    );
    const headings = createOracleStreamEvents(result).flatMap((event) =>
      event.type === "phase" && event.phase === "cardInterpretation" ? [event.heading] : [],
    );
    expect(headings).toEqual([
      "Situation · The High Priestess",
      "Challenge · Temperance, reversed",
      "Direction · Five of Pentacles, reversed",
    ]);
    expect(result.cards[0]?.positionInterpretation).toMatch(
      /^The High Priestess sits in your Situation — /,
    );
    expect(result.cards[1]?.coreMeaning).toMatch(/^Reversed, Temperance can point to /);
    expect(result.cards[2]?.coreMeaning).toMatch(/^Reversed, the Five of Pentacles can point to /);
    const drawer = result.cards.flatMap(({ coreMeaning, supportingEvidence }) => [
      coreMeaning,
      ...supportingEvidence,
    ]);
    expect(drawer.join(" ")).not.toMatch(/approved|facet used here|themes —/i);
    expect(result.directAnswer).not.toMatch(/Your next move around|The Temperance/);
    expect(result.directAnswer).toContain("The Five of Pentacles reversed makes that");
  });

  it("does not repeat the section heading at the start of Your move", async () => {
    const { result } = await reading("three-card", "How should I plan my work?");
    expect(result.userAgency).not.toMatch(/^Your move/i);
    const legacy = { ...result, userAgency: "Your move: ask for one concrete fact; then wait." };
    const agency = createOracleStreamEvents(legacy).find(
      (event) => event.type === "phase" && event.phase === "userAgency",
    );
    expect(agency?.type === "phase" ? agency.text : "").toBe(
      "Ask for one concrete fact; then wait.",
    );
  });

  it("closes warmly and keeps the trajectory sentence natural", async () => {
    const { result } = await reading("three-card", "How should I plan my work?");
    expect(result.uncertaintyNote).toBe(
      "Nothing here is fixed — what you notice and choose next can shift it.",
    );
    expect(result.likelyTrajectory ?? "").not.toMatch(/holds, as this develops/);
  });

  it("mentions another person's motives only when the question involves one", async () => {
    const work = await reading(
      "three-card",
      "What should I understand about the next step in my work?",
    );
    const workFollowUp = await provider.generateFollowUp({
      ...work.input,
      question: "What should I focus on first?",
      originalResult: work.result,
    });
    expect(workFollowUp.response).not.toMatch(/other person/i);

    const love = await reading("three-card", "What should I understand about my relationship?");
    const loveFollowUp = await provider.generateFollowUp({
      ...love.input,
      question: "What should I focus on first?",
      originalResult: love.result,
    });
    expect(loveFollowUp.response).toMatch(/other person's private motives/);
    expect(createFollowUpStreamEvents(loveFollowUp)).toHaveLength(1);
  });

  it("keeps generated readings inside the output safety guard", async () => {
    for (const [spreadId, question] of spreadQuestions) {
      const { input, result } = await reading(spreadId, question);
      expect(generatedOutputSafetyViolation(result)).toBeUndefined();
      const followUp = await provider.generateFollowUp({
        ...input,
        question: "What should I focus on first?",
        originalResult: result,
      });
      expect(generatedOutputSafetyViolation(followUp)).toBeUndefined();
    }
  });
});
