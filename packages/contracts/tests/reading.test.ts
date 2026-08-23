import { describe, expect, it } from "vitest";

import {
  followUpResultSchema,
  normalizeFollowUpResult,
  normalizeReadingResult,
  readingResultV2Schema,
  readingResultV3Schema,
} from "../src";

const currentResult = {
  schemaVersion: "reading-result-v3" as const,
  directAnswer: "The current pattern suggests a deliberate next step instead of a forced answer.",
  overallPattern: "The cards move from assessment through friction toward chosen direction.",
  cards: [
    {
      positionId: "situation",
      positionLabel: "Situation",
      cardId: "major-00",
      orientation: "upright" as const,
      coreMeaning: "A willing beginning.",
      positionInterpretation: "In Situation, the card shows that a genuine opening already exists.",
      relationshipNotes: ["It contrasts with the restraint shown in Challenge."],
      supportingEvidence: ["The Fool upright in Situation"],
    },
  ],
  synthesis: "The opening matters because it can be approached with attention rather than urgency.",
  likelyTrajectory: null,
  alternatePath: null,
  timing: null,
  userAgency: "Name the first reversible action and observe what changes.",
  reflectionPrompt: "What beginning can you test without demanding certainty?",
  uncertaintyNote: "Tarot reflects present patterns and choices; it does not guarantee an outcome.",
  personalizationLens: null,
  safetyFlags: [],
};

describe("spread-aware reading contract", () => {
  it("accepts an evidence-linked result without manufacturing optional outlook sections", () => {
    const result = readingResultV3Schema.parse(currentResult);
    expect(result.likelyTrajectory).toBeNull();
    expect(result.alternatePath).toBeNull();
    expect(result.timing).toBeNull();
    expect(result.cards[0]?.supportingEvidence).toEqual(["The Fool upright in Situation"]);
  });

  it("rejects duplicate card or position lineage", () => {
    const duplicate = {
      ...currentResult,
      cards: [currentResult.cards[0], { ...currentResult.cards[0] }],
    };
    expect(() => readingResultV3Schema.parse(duplicate)).toThrow();
  });

  it("keeps personalization separately labeled", () => {
    const result = readingResultV3Schema.parse({
      ...currentResult,
      personalizationLens: {
        label: "Personalized reflection",
        observations: [
          "You may find a reversible experiment easier to trust than a permanent leap.",
        ],
      },
    });
    expect(result.personalizationLens?.label).toBe("Personalized reflection");
  });

  it("normalizes persisted v2 readings without losing locked-card lineage", () => {
    const historical = readingResultV2Schema.parse({
      schemaVersion: "reading-result-v2",
      title: "Something is beginning to move",
      passages: [
        {
          id: "opening",
          role: "opening",
          text: "An opening is present.",
          cardReferences: ["focus"],
        },
        {
          id: "turn",
          role: "turningPoint",
          text: "A practical choice changes the pattern.",
          cardReferences: ["focus"],
        },
        {
          id: "alternate",
          role: "alternative",
          text: "Waiting remains another route.",
          cardReferences: [],
        },
      ],
      cards: [
        {
          positionId: "focus",
          cardId: "major-00",
          orientation: "upright",
          passageIds: ["opening", "turn"],
        },
      ],
      trajectory: {
        likelyPassageId: "turn",
        conditions: ["Conditions continue"],
        alternatePassageId: "alternate",
      },
      userAgency: ["Choose one observable action."],
      reflectionQuestion: "What can you test?",
      disconfirmingEvidence: ["The opening closes."],
      uncertainty: "The direction is conditional.",
      safetyFlags: [],
    });
    const normalized = normalizeReadingResult(historical);
    expect(normalized.schemaVersion).toBe("reading-result-v3");
    expect(normalized.cards[0]).toMatchObject({ positionId: "focus", cardId: "major-00" });
    expect(normalized.cards[0]?.positionInterpretation).toContain("An opening is present.");
  });

  it("normalizes persisted v1 readings into the same contract", () => {
    const normalized = normalizeReadingResult({
      title: "Legacy",
      directAnswer: "Direct answer.",
      centralTheme: "Theme.",
      cards: [
        {
          positionId: "focus",
          cardId: "major-00",
          orientation: "upright",
          traditionalMeaning: "Traditional.",
          personalizedMeaning: "Profile connection.",
          questionConnection: "Question connection.",
        },
      ],
      synthesis: "Synthesis.",
      likelyTrajectory: {
        summary: "Summary.",
        conditions: ["Condition."],
        alternateTrajectory: "Alternate.",
      },
      userAgency: ["Action."],
      reflectionQuestion: "Reflection?",
      disconfirmingEvidence: ["Evidence."],
      uncertainty: "Uncertainty.",
      safetyFlags: [],
    });
    expect(normalized.schemaVersion).toBe("reading-result-v3");
    expect(normalized.cards[0]?.coreMeaning).toBe("Traditional.");
  });
});

describe("follow-up result contract", () => {
  it("accepts exactly one same-draw response", () => {
    expect(followUpResultSchema.parse({ response: "A focused clarification." })).toEqual({
      response: "A focused clarification.",
    });
    expect(() => followUpResultSchema.parse({ response: "", synthesis: "Extra" })).toThrow();
  });

  it("normalizes historical full-reading follow-ups", () => {
    const normalized = normalizeFollowUpResult({
      title: "Legacy",
      directAnswer: "Direct answer.",
      centralTheme: "Theme.",
      cards: [
        {
          positionId: "focus",
          cardId: "major-00",
          orientation: "upright",
          traditionalMeaning: "Traditional.",
          personalizedMeaning: "Profile connection.",
          questionConnection: "Question connection.",
        },
      ],
      synthesis: "Synthesis.",
      likelyTrajectory: {
        summary: "Summary.",
        conditions: ["Condition."],
        alternateTrajectory: "Alternate.",
      },
      userAgency: ["Action."],
      reflectionQuestion: "Reflection?",
      disconfirmingEvidence: ["Evidence."],
      uncertainty: "Uncertainty.",
      safetyFlags: [],
    });
    expect(normalized.response).toContain("Profile connection.");
  });
});
