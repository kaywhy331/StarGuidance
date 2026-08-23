import { z } from "zod";
import {
  birthDateSchema,
  drawCeremonySchema,
  followUpResultSchema,
  oracleStreamEventSchema,
  personalizationModeSchema,
  questionClassificationSchema,
  readingConfigurationSchema,
  readingResultSchema,
  reversalModeSchema,
} from "@starguidance/contracts";

export const FREE_GUEST_SPREAD_IDS = ["three-card", "one-card"] as const;
export const GUEST_DEVICE_HEADER = "x-starguidance-guest-device";
export const GUEST_DEVICE_STORAGE_KEY = "sg:guest-device:v1";
export const GUEST_READING_SESSION_KEY = "sg:guest-reading:v2";
export const GUEST_READING_RECEIPT_KEY = "sg:guest-reading-receipt:v1";
export const GUEST_TRIAL_LOCAL_MARKER_KEY = "sg:guest-trial-used:v1";

export const guestDeviceIdSchema = z.string().uuid();

export const guestReadingPrepareInputSchema = z
  .object({
    action: z.literal("prepare"),
    spreadId: z.enum(FREE_GUEST_SPREAD_IDS),
    birthDate: birthDateSchema,
    question: z.string().trim().min(1).max(500),
    questionConfirmed: z.literal(true),
    reversalMode: reversalModeSchema.default("reversals_enabled"),
    personalizationMode: personalizationModeSchema.default("personalized_tarot"),
    continueAsReflection: z.boolean().optional().default(false),
    termsAccepted: z.literal(true),
    privacyAccepted: z.literal(true),
    ageConfirmed: z.literal(true),
  })
  .strict();

export const guestReadingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review"), question: z.string().trim().min(1).max(500) }).strict(),
  guestReadingPrepareInputSchema,
  z
    .object({ action: z.literal("restore"), ceremonyToken: z.string().min(32).max(65_536) })
    .strict(),
  z
    .object({
      action: z.literal("finalize"),
      ceremonyToken: z.string().min(32).max(65_536),
      clientNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      cutIndex: z.number().int().min(0).max(77),
    })
    .strict(),
  z.object({ action: z.literal("recover"), receipt: z.string().min(32).max(65_536) }).strict(),
  z.object({ action: z.literal("reveal"), receipt: z.string().min(32).max(65_536) }).strict(),
]);

export const guestDrawSchema = z
  .object({
    id: z.string().uuid(),
    deckVersion: z.string().min(1),
    spreadId: z.string().min(1),
    spreadVersion: z.string().min(1),
    shuffleVersion: z.string().min(1),
    assignments: z
      .array(
        z
          .object({
            positionId: z.string().min(1),
            cardId: z.string().min(1),
            orientation: z.enum(["upright", "reversed"]),
            order: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(10)
      .readonly(),
    proof: z
      .object({
        entropyVersion: z.string().min(1),
        serverSeedCommitment: z.string().min(1),
        clientNonceHash: z.string().min(1),
        cutIndex: z.number().int().min(0).max(77),
        reversalMode: reversalModeSchema,
      })
      .strict()
      .optional(),
    lockedAt: z.string().datetime(),
  })
  .strict();

const tarotArtworkSchema = z
  .object({
    artworkId: z.string().min(1),
    frontAsset: z.string().min(1),
    backAsset: z.string().min(1),
    backAssetAvif: z.string().min(1).optional(),
    altText: z.string(),
    artistCredit: z.string().min(1),
    license: z.string().min(1),
    source: z.string().min(1),
    provenance: z.string().min(1),
    focalPoint: z.object({ x: z.number(), y: z.number() }).strict(),
    crop: z.enum(["center", "top", "bottom"]),
    artworkVersion: z.string().min(1),
  })
  .strict();

export const guestDealtCardSchema = z
  .object({
    cardId: z.string().min(1),
    name: z.string().min(1),
    orientation: z.enum(["upright", "reversed"]),
    themes: z.array(z.string().min(1)).min(1),
    baselineMeaning: z.string().min(1),
    positionId: z.string().min(1),
    positionName: z.string().min(1),
    positionDescription: z.string().min(1),
    placement: z
      .object({
        column: z.number().int().nonnegative(),
        row: z.number().int().nonnegative(),
        rotation: z.number(),
        layer: z.number().int(),
      })
      .strict(),
    spreadLayout: z
      .object({
        columns: z.number().int().positive(),
        rows: z.number().int().positive(),
        kind: z.string().min(1),
      })
      .strict(),
    artwork: tarotArtworkSchema,
  })
  .strict();

export const guestReadingDisplaySchema = z
  .object({
    id: z.string().uuid(),
    spreadId: z.enum(FREE_GUEST_SPREAD_IDS),
    question: z.string().min(1).max(500),
    configuration: readingConfigurationSchema,
    draw: guestDrawSchema,
    cards: z.array(guestDealtCardSchema).min(1).max(3),
    result: readingResultSchema.optional(),
    previewEvents: z.array(oracleStreamEventSchema).min(1).max(24).optional(),
    questionClassification: questionClassificationSchema,
    createdAt: z.string().datetime(),
    receiptExpiresAt: z.string().datetime(),
  })
  .strict();

export const guestReadingResponseSchema = z
  .object({ reading: guestReadingDisplaySchema, receipt: z.string().min(32).max(65_536) })
  .strict();

export const guestReceiptPayloadSchema = z
  .object({
    version: z.literal("guest-reading-receipt-v2"),
    readingId: z.string().uuid(),
    question: z.string().min(1).max(500),
    questionClassification: questionClassificationSchema,
    configuration: readingConfigurationSchema,
    readerLens: z.array(z.string().min(1)).max(4).readonly(),
    draw: guestDrawSchema,
    result: readingResultSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const guestContinuationInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("recover"), receipt: z.string().min(32).max(65_536) }),
  z.object({
    action: z.literal("followUp"),
    receipt: z.string().min(32).max(65_536),
    question: z.string().trim().min(1).max(500),
  }),
]);

export const guestFollowUpResponseSchema = z
  .object({
    followUp: followUpResultSchema,
    previewEvents: z.array(oracleStreamEventSchema).min(1).max(4),
    personalizedByPrivateProfile: z.boolean(),
  })
  .strict();

export type GuestDrawCeremony = z.infer<typeof drawCeremonySchema>;
export type GuestReadingDisplay = z.infer<typeof guestReadingDisplaySchema>;
export type GuestReadingResponse = z.infer<typeof guestReadingResponseSchema>;
export type GuestReceiptPayload = z.infer<typeof guestReceiptPayloadSchema>;
export type GuestFollowUpResponse = z.infer<typeof guestFollowUpResponseSchema>;
