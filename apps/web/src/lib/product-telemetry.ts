import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { localStore } from "./local-store";
import { getRuntimeAdapter, getSystemDatabaseClient } from "./runtime";

export const PRODUCT_EVENT_NAMES = [
  "landing_view",
  "pricing_view",
  "signup_started",
  "consent_completed",
  "profile_started",
  "profile_completed",
  "reading_selected",
  "question_submitted",
  "shuffle_started",
  "draw_locked",
  "card_revealed",
  "result_viewed",
  "followup_submitted",
  "feedback_submitted",
  "reading_reopened",
  "outcome_invited",
  "outcome_submitted",
  "report_previewed",
  "checkout_started",
  "purchase_completed",
  "report_ready",
  "report_viewed",
  "auth_failed",
  "profile_failed",
  "generation_completed",
  "generation_failed",
  "fallback_used",
  "payment_failed",
  "job_retried",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

const safeToken = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i);
const safeVersionToken = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/i);

const eventPropertiesSchema = z
  .object({
    routeClass: z
      .enum([
        "landing",
        "pricing",
        "signup",
        "consent",
        "onboarding",
        "catalog",
        "question",
        "ritual",
        "result",
        "history",
        "profile",
        "report",
        "operations",
      ])
      .optional(),
    referrerClass: z.enum(["direct", "internal", "external"]).optional(),
    deviceClass: z.enum(["mobile", "tablet", "desktop"]).optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
      .optional(),
    completeness: z.enum(["core", "locationEnhanced", "complete"]).optional(),
    birthplacePresent: z.boolean().optional(),
    birthTimePresent: z.boolean().optional(),
    spreadId: safeToken.optional(),
    spreadVersion: safeToken.optional(),
    cardCount: z.number().int().min(1).max(78).optional(),
    topic: z.enum(["general", "relationships", "career", "change", "wellbeing"]).optional(),
    horizon: z.enum(["open", "immediate", "weeks", "months"]).optional(),
    questionLength: z.number().int().min(0).max(2_000).optional(),
    generalReading: z.boolean().optional(),
    generationMode: z.enum(["live", "deterministic"]).optional(),
    fallbackUsed: z.boolean().optional(),
    feedbackKind: z.enum(["experience", "outcome"]).optional(),
    outcomeStatus: z.enum(["occurred", "partial", "did_not_occur", "unclear"]).optional(),
    behaviorChanged: z.boolean().optional(),
    ratingBand: z.enum(["low", "mid", "high"]).optional(),
    readingAgeBucket: z.enum(["same_day", "1_7d", "8_30d", "31_90d", "gt_90d"]).optional(),
    productId: safeToken.optional(),
    priceId: safeToken.optional(),
    campaignClass: z.enum(["direct", "owned", "earned", "paid", "partner", "unknown"]).optional(),
    modelVersion: safeVersionToken.optional(),
    provider: z.enum(["local", "stripe", "groq", "groq-gateway", "deterministic"]).optional(),
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .optional(),
    priceMinor: z.number().int().min(0).max(100_000_000).optional(),
    statusClass: z
      .enum(["started", "completed", "pending", "ready", "failed", "refunded", "revoked"])
      .optional(),
    errorClass: z
      .enum([
        "validation",
        "authentication",
        "authorization",
        "rate_limited",
        "provider_timeout",
        "provider_rejected",
        "schema_invalid",
        "persistence",
        "configuration",
        "unclassified",
      ])
      .optional(),
    durationBucket: z.enum(["lt_1s", "1_5s", "5_15s", "15_40s", "gt_40s"]).optional(),
  })
  .strict();

export const productEventSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(8)
      .max(160)
      .regex(/^[a-z0-9][a-z0-9:._-]*$/i),
    name: z.enum(PRODUCT_EVENT_NAMES),
    properties: eventPropertiesSchema,
  })
  .strict();

export type ProductEvent = z.infer<typeof productEventSchema>;

export function classifyProductProvider(
  providerId: string,
): "deterministic" | "groq" | "groq-gateway" {
  if (providerId.startsWith("groq-gateway:")) return "groq-gateway";
  if (providerId.startsWith("groq:")) return "groq";
  return "deterministic";
}

export function productModelVersion(providerId: string): string {
  if (providerId.startsWith("groq-gateway:")) return providerId.slice("groq-gateway:".length);
  if (providerId.startsWith("groq:")) return providerId.slice("groq:".length);
  return providerId.split(":", 1)[0] || "deterministic-fallback-v1";
}

export function productDurationBucket(
  durationMs: number,
): "lt_1s" | "1_5s" | "5_15s" | "15_40s" | "gt_40s" {
  if (durationMs < 1_000) return "lt_1s";
  if (durationMs < 5_000) return "1_5s";
  if (durationMs < 15_000) return "5_15s";
  if (durationMs < 40_000) return "15_40s";
  return "gt_40s";
}

function eventKeyDigest(value: string): string {
  return createHash("sha256").update(`starguidance-product-event-v1:${value}`).digest("hex");
}

/**
 * Persists a privacy-minimized first-party event. The schema has no arbitrary
 * strings or user/content fields, and the idempotency key is irreversibly
 * digested before storage. Callers decide whether a failed measurement should
 * be surfaced; user-facing flows normally use tryRecordProductEvent.
 */
export async function recordProductEvent(candidate: ProductEvent): Promise<void> {
  const event = productEventSchema.parse(candidate);
  const idempotencyKey = eventKeyDigest(event.idempotencyKey);
  const properties = Object.fromEntries(
    Object.entries(event.properties).filter(
      (entry): entry is [string, string | number | boolean] => entry[1] !== undefined,
    ),
  );
  if (getRuntimeAdapter() === "local") {
    localStore.productEvents.set(idempotencyKey, {
      eventName: event.name,
      properties,
    });
    return;
  }

  const client = getSystemDatabaseClient();
  await client`
    insert into product_events (idempotency_key, event_name, properties)
    values (${idempotencyKey}, ${event.name}, ${client.json(properties)})
    on conflict (idempotency_key) do nothing
  `;
}

export async function tryRecordProductEvent(event: ProductEvent): Promise<void> {
  try {
    await recordProductEvent(event);
  } catch {
    // Measurement must never block auth, profile, reading, safety, privacy,
    // or paid fulfillment. Operational readiness separately reports whether
    // the event store is configured and writable.
  }
}
