import { describe, expect, it } from "vitest";

import {
  followUpResultSchema,
  normalizeFollowUpResult,
  normalizeReadingResult,
  readingResultV2Schema,
} from "../src";

describe("follow-up result contract", () => {
  it("accepts exactly one response section", () => {
    expect(followUpResultSchema.parse({ response: "A focused answer." })).toEqual({
      response: "A focused answer.",
    });
    expect(() => followUpResultSchema.parse({ response: "" })).toThrow();
    expect(() =>
      followUpResultSchema.parse({
        response: "A focused answer.",
        synthesis: "Not another reading.",
      }),
    ).toThrow();
  });

  it("normalizes legacy full-reading follow-ups into one response", () => {
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
    expect(normalized).toEqual({
      response: "Direct answer. Profile connection. Synthesis. Action.",
    });
  });
});

describe("narration-first reading contract", () => {
  it("validates passages with invisible card-reference metadata", () => {
    const result = readingResultV2Schema.parse({
      schemaVersion: "reading-result-v2",
      title: "Something is beginning to move",
      passages: [
        {
          id: "opening",
          role: "opening",
          text: "It feels like the waiting has almost done what it needed to do.",
          cardReferences: ["card-1"],
        },
        {
          id: "turn",
          role: "turningPoint",
          text: "The turning point may come with one practical invitation.",
          cardReferences: ["card-1"],
        },
        {
          id: "alternate",
          role: "alternative",
          text: "If the invitation never arrives, the quieter path remains available.",
          cardReferences: [],
        },
      ],
      cards: [
        {
          positionId: "card-1",
          cardId: "pentacles-four",
          orientation: "upright",
          passageIds: ["opening", "turn"],
        },
      ],
      trajectory: {
        likelyPassageId: "turn",
        conditions: ["The present pattern continues"],
        alternatePassageId: "alternate",
      },
      userAgency: ["Notice the invitation before protecting the status quo"],
      reflectionQuestion: "What are you protecting, and what is it now strong enough to support?",
      disconfirmingEvidence: ["No practical opening develops"],
      uncertainty: "The direction is conditional, not guaranteed.",
      safetyFlags: [],
    });
    expect(result.passages[0]?.text).not.toContain("Traditional current");
  });

  it("normalizes persisted v1 readings without losing their locked-card lineage", () => {
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
    expect(normalized.schemaVersion).toBe("reading-result-v2");
    expect(normalized.cards[0]).toMatchObject({
      positionId: "focus",
      cardId: "major-00",
      orientation: "upright",
    });
    expect(normalized.passages.map(({ text }) => text).join(" ")).toContain("Profile connection.");
  });
});
