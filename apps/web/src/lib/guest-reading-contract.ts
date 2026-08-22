import { z } from "zod";
import {
  birthDateSchema,
  followUpResultSchema,
  oracleStreamEventSchema,
  questionClassificationSchema,
  readingResultSchema,
} from "@starguidance/contracts";

export const FREE_GUEST_SPREAD_IDS = ["three-card", "one-card"] as const;
export const GUEST_DEVICE_HEADER = "x-starguidance-guest-device";
export const GUEST_DEVICE_STORAGE_KEY = "sg:guest-device:v1";
export const GUEST_READING_SESSION_KEY = "sg:guest-reading:v1";
export const GUEST_READING_RECEIPT_KEY = "sg:guest-reading-receipt:v1";
export const GUEST_TRIAL_LOCAL_MARKER_KEY = "sg:guest-trial-used:v1";

export const guestDeviceIdSchema = z.string().uuid();

export const guestReadingInputSchema = z.object({
  spreadId: z.enum(FREE_GUEST_SPREAD_IDS),
  birthDate: birthDateSchema,
  question: z.string().trim().min(1).max(500),
  continueAsReflection: z.boolean().optional().default(false),
  termsAccepted: z.literal(true),
  privacyAccepted: z.literal(true),
  ageConfirmed: z.literal(true),
});

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
    lockedAt: z.string().datetime(),
  })
  .strict();

const tarotArtworkSchema = z
  .object({
    artworkId: z.string().min(1),
    frontAsset: z.string().min(1),
    backAsset: z.string().min(1),
    backAssetAvif: z.string().min(1),
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
    draw: guestDrawSchema,
    cards: z.array(guestDealtCardSchema).min(1).max(3),
    result: readingResultSchema,
    previewEvents: z.array(oracleStreamEventSchema).min(1).max(24),
    questionClassification: questionClassificationSchema,
    createdAt: z.string().datetime(),
    receiptExpiresAt: z.string().datetime(),
  })
  .strict();

export const guestReadingResponseSchema = z
  .object({
    reading: guestReadingDisplaySchema,
    receipt: z.string().min(32).max(65_536),
  })
  .strict();

export const guestReceiptPayloadSchema = z
  .object({
    version: z.literal("guest-reading-receipt-v1"),
    readingId: z.string().uuid(),
    question: z.string().min(1).max(500),
    questionClassification: questionClassificationSchema,
    draw: guestDrawSchema,
    result: readingResultSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

export const guestContinuationInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("recover"),
    receipt: z.string().min(32).max(65_536),
  }),
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

export type GuestReadingDisplay = z.infer<typeof guestReadingDisplaySchema>;
export type GuestReadingResponse = z.infer<typeof guestReadingResponseSchema>;
export type GuestReceiptPayload = z.infer<typeof guestReceiptPayloadSchema>;
export type GuestFollowUpResponse = z.infer<typeof guestFollowUpResponseSchema>;
