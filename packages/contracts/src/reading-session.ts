import { z } from "zod";

export const GENERAL_READING_QUESTION =
  "What would be most useful for me to notice and reflect on right now?";

export const readingTopicSchema = z.enum([
  "general",
  "career",
  "relationships",
  "change",
  "wellbeing",
]);
export const readingHorizonSchema = z.enum(["open", "immediate", "weeks", "months"]);
export const readingIntentSchema = z.enum([
  "generalReflection",
  "clarity",
  "decisionSupport",
  "planning",
  "emotionalProcessing",
]);

export const questionClassificationSchema = z.object({
  version: z.literal("question-classification-v1"),
  topic: readingTopicSchema,
  horizon: readingHorizonSchema,
  intent: readingIntentSchema,
  generalReading: z.boolean(),
});

export const readingEntitlementDecisionSchema = z.object({
  version: z.literal("reading-entitlement-v1"),
  mode: z.enum(["unlimited", "free-window"]),
  outcome: z.enum(["granted", "limitReached"]),
  entitlementClass: z.literal("standard"),
  used: z.number().int().nonnegative(),
  limit: z.number().int().positive().nullable(),
  remaining: z.number().int().nonnegative().nullable(),
  windowStartsAt: z.string().datetime().nullable(),
  windowEndsAt: z.string().datetime().nullable(),
});

export const ritualProgressSchema = z.object({
  version: z.literal("ritual-progress-v1"),
  phase: z.enum(["cuttingDeck", "revealingCards", "complete"]),
  cutTaken: z.boolean(),
  revealedIndexes: z.array(z.number().int().nonnegative()).max(7).readonly(),
  updatedAt: z.string().datetime(),
});

export type ReadingTopic = z.infer<typeof readingTopicSchema>;
export type ReadingHorizon = z.infer<typeof readingHorizonSchema>;
export type ReadingIntent = z.infer<typeof readingIntentSchema>;
export type QuestionClassification = z.infer<typeof questionClassificationSchema>;
export type ReadingEntitlementDecision = z.infer<typeof readingEntitlementDecisionSchema>;
export type StoredRitualProgress = z.infer<typeof ritualProgressSchema>;
