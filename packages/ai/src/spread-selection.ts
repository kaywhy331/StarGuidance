import type { QuestionClassification } from "@starguidance/contracts";

export const AUTOMATIC_SPREAD_SELECTION_VERSION = "question-spread-routing-v1" as const;

/**
 * Selects structure, never cards. The result depends only on the question's
 * already validated intent/topic and the deployment's enabled spread IDs.
 * The secure deck shuffle remains a separate domain operation.
 */
export function recommendSpreadId(input: {
  question: string;
  classification: QuestionClassification;
  availableSpreadIds: readonly string[];
}): string | undefined {
  const available = new Set(input.availableSpreadIds);
  const question = input.question.trim();
  const wordCount = question.split(/\s+/u).filter(Boolean).length;
  const complex =
    wordCount >= 26 ||
    /\b(?:deep(?:er)?|long[- ]term|recurring|pattern|many factors|complicated|complex)\b/i.test(
      question,
    );
  const mentionsPerson = /(^|\s)@[\p{L}\p{N}]/u.test(question);
  const explicitlyPlanning = /\b(?:plan|prepare|next step|approach)\b/i.test(question);
  const reflectiveShould = /\bwhat should i (?:understand|notice|know|focus on)\b/i.test(question);

  const preferred =
    input.classification.topic === "relationships" || mentionsPerson
      ? ["relationship", "three-card", "crossroads"]
      : explicitlyPlanning
        ? ["horseshoe", "three-card", "crossroads"]
        : reflectiveShould && input.classification.horizon === "immediate" && wordCount <= 16
          ? ["one-card", "three-card"]
          : input.classification.intent === "decisionSupport"
            ? ["crossroads", "three-card", "one-card"]
            : complex && input.classification.horizon === "months"
              ? ["celtic-cross", "outlook", "nine-card-matrix", "three-card"]
              : input.classification.horizon === "months"
                ? ["outlook", "horseshoe", "three-card"]
                : input.classification.intent === "emotionalProcessing"
                  ? ["three-card", "relationship", "one-card"]
                  : input.classification.horizon === "immediate" && wordCount <= 16
                    ? ["one-card", "three-card"]
                    : ["three-card", "one-card"];

  return preferred.find((spreadId) => available.has(spreadId)) ?? input.availableSpreadIds[0];
}
