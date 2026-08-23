import assert from "node:assert/strict";

import {
  GroqInterpretationProvider,
  REVIEWED_GATEWAY_SYSTEM_PROMPTS,
  reviewedReadingResponseSchema,
} from "@starguidance/ai";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import type { LockedDraw } from "@starguidance/tarot-domain";

const spread = spreads.find(({ id }) => id === "three-card");
assert(spread);
assert(spread.capabilities);
const draw = {
  id: "synthetic-ci-draw",
  deckVersion: DECK_VERSION,
  spreadId: spread.id,
  spreadVersion: spread.version,
  shuffleVersion: "secure-fisher-yates-v1",
  lockedAt: new Date(0).toISOString(),
  assignments: spread.positions.map((position, index) => ({
    positionId: position.id,
    cardId: tarotCards[index + 10]!.id,
    orientation: index === 1 ? ("reversed" as const) : ("upright" as const),
    order: index,
  })),
} satisfies LockedDraw;
const input = {
  draw,
  configuration: {
    version: "reading-configuration-v1" as const,
    reversalMode: "reversals_enabled" as const,
    personalizationMode: "personalized_tarot" as const,
    positions: spread.positions,
    capabilities: spread.capabilities,
  },
  question: "Should I take the new role at work?",
  questionClassification: {
    version: "question-classification-v1" as const,
    topic: "career" as const,
    horizon: "open" as const,
    intent: "decisionSupport" as const,
    generalReading: false,
  },
  relevantTraitStatements: ["You commit quickly once a direction feels right."],
};
const provider = new GroqInterpretationProvider({
  apiKey: "synthetic-only-payload-builder",
  model: "openai/gpt-oss-120b",
});
const payload = provider.buildPayload(input);
const resolved = draw.assignments.map((assignment) => {
  const position = spread.positions.find(({ id }) => id === assignment.positionId);
  const card = tarotCards.find(({ id }) => id === assignment.cardId);
  assert(position);
  assert(card);
  return {
    position,
    card,
    orientation: assignment.orientation,
    themes: assignment.orientation === "upright" ? card.uprightThemes : card.reversedThemes,
  };
});
const schema = reviewedReadingResponseSchema(resolved, input.configuration);

process.stdout.write(
  JSON.stringify({
    model: "openai/gpt-oss-120b",
    temperature: 0.85,
    max_completion_tokens: 900,
    reasoning_effort: "low",
    include_reasoning: false,
    messages: [
      { role: "system", content: REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading },
      { role: "user", content: JSON.stringify(payload) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "reading", strict: true, schema },
    },
  }),
);
