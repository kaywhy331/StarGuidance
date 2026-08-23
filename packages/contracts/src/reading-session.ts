import { z } from "zod";

export const GENERAL_READING_QUESTION = "What is most important for me to understand at this time?";

export const reversalModeSchema = z.enum(["reversals_enabled", "upright_only"]);
export const personalizationModeSchema = z.enum(["pure_tarot", "personalized_tarot"]);

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

const ritualProgressV1Schema = z.object({
  version: z.literal("ritual-progress-v1"),
  phase: z.enum(["cuttingDeck", "revealingCards", "complete"]),
  cutTaken: z.boolean(),
  revealedIndexes: z.array(z.number().int().nonnegative()).max(10).readonly(),
  updatedAt: z.string().datetime(),
});

export const readingLifecycleStageSchema = z.enum([
  "drawLocked",
  "dealing",
  "awaitingReveal",
  "revealing",
  "fullSpreadReady",
  "interpretationStreaming",
  "followUpAvailable",
  "complete",
]);

const ritualProgressV2Schema = z
  .object({
    version: z.literal("ritual-progress-v2"),
    phase: readingLifecycleStageSchema,
    cutIndex: z.number().int().min(0).max(77),
    revealedIndexes: z.array(z.number().int().nonnegative()).max(10).readonly(),
    updatedAt: z.string().datetime(),
  })
  .strict();

/** Historical v1 rows hydrate into the current lifecycle contract. */
export const ritualProgressSchema = z
  .union([ritualProgressV2Schema, ritualProgressV1Schema])
  .transform((progress) =>
    progress.version === "ritual-progress-v2"
      ? progress
      : ritualProgressV2Schema.parse({
          version: "ritual-progress-v2",
          phase:
            progress.phase === "revealingCards"
              ? "revealing"
              : progress.phase === "complete"
                ? "complete"
                : "drawLocked",
          cutIndex: progress.cutTaken ? 39 : 0,
          revealedIndexes: progress.revealedIndexes,
          updatedAt: progress.updatedAt,
        }),
  );

export const spreadPositionSnapshotSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    interpretiveFunction: z.string().min(1),
    description: z.string().min(1),
    order: z.number().int().nonnegative(),
    placement: z
      .object({
        column: z.number().int().nonnegative(),
        row: z.number().int().nonnegative(),
        rotation: z.number(),
        layer: z.number().int(),
      })
      .strict(),
  })
  .strict();

export const spreadCapabilitySnapshotSchema = z
  .object({
    trajectoryPositionIds: z.array(z.string().min(1)).readonly(),
    alternativePositionGroups: z.array(z.array(z.string().min(1)).readonly()).readonly(),
    timingMethod: z
      .object({ id: z.string().min(1), positionIds: z.array(z.string().min(1)).min(1).readonly() })
      .strict()
      .nullable(),
    linkedPositions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            positionIds: z.array(z.string().min(1)).min(2).readonly(),
            relationship: z.enum(["sequence", "compare", "tension", "integration"]),
          })
          .strict(),
      )
      .readonly(),
  })
  .strict();

export const readingConfigurationSchema = z
  .object({
    version: z.literal("reading-configuration-v1"),
    reversalMode: reversalModeSchema,
    personalizationMode: personalizationModeSchema,
    positions: z.array(spreadPositionSnapshotSchema).min(1).max(10).readonly(),
    capabilities: spreadCapabilitySnapshotSchema,
  })
  .strict();

export const drawCeremonySchema = z
  .object({
    version: z.literal("draw-ceremony-v1"),
    sessionId: z.string().uuid(),
    token: z.string().min(32).max(65_536),
    deckVersion: z.string().min(1),
    serverSeedCommitment: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    expiresAt: z.string().datetime(),
    question: z.string().trim().min(1).max(500),
    spread: z
      .object({
        id: z.string().min(1),
        version: z.string().min(1),
        name: z.string().min(1),
        positions: z.array(spreadPositionSnapshotSchema).min(1).max(10).readonly(),
      })
      .strict(),
    configuration: readingConfigurationSchema,
  })
  .strict();

export const drawFinalizationInputSchema = z
  .object({
    action: z.literal("finalize"),
    ceremonyToken: z.string().min(32).max(65_536),
    clientNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    cutIndex: z.number().int().min(0).max(77),
  })
  .strict();

export type ReadingTopic = z.infer<typeof readingTopicSchema>;
export type ReadingHorizon = z.infer<typeof readingHorizonSchema>;
export type ReadingIntent = z.infer<typeof readingIntentSchema>;
export type QuestionClassification = z.infer<typeof questionClassificationSchema>;
export type ReadingEntitlementDecision = z.infer<typeof readingEntitlementDecisionSchema>;
export type StoredRitualProgress = z.infer<typeof ritualProgressSchema>;
export type ReadingLifecycleStage = z.infer<typeof readingLifecycleStageSchema>;
export type ReversalMode = z.infer<typeof reversalModeSchema>;
export type PersonalizationMode = z.infer<typeof personalizationModeSchema>;
export type ReadingConfiguration = z.infer<typeof readingConfigurationSchema>;
export type DrawCeremony = z.infer<typeof drawCeremonySchema>;
