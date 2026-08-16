import { z } from "zod";

export * from "./profile";
export * from "./reading";
export * from "./reading-session";

/**
 * HMAC context string binding the Netlify-scheduled trigger
 * (netlify/functions/process-interpretation-jobs.mts) to the Next.js drain
 * route (apps/web/src/app/api/internal/interpretation-jobs/route.ts). Shared
 * here so the two sides — and their tests — can't drift apart silently; the
 * Netlify function still keeps its own literal copy rather than importing
 * this package at runtime (netlify.toml requires it dependency-free), but
 * exports that copy so a test can assert it stays equal to this one.
 */
export const INTERPRETATION_WORKER_TOKEN_CONTEXT = "starguidance-interpretation-worker-v1";

export const serviceHealthSchema = z.object({
  service: z.string().min(1),
  status: z.literal("ok"),
  version: z.string().min(1),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

export const unavailableCapabilitySchema = z.object({
  status: z.literal("unavailable"),
  capability: z.string().min(1),
  reason: z.enum(["missing_data", "feature_disabled", "unvalidated", "unlicensed"]),
  activationRequirements: z.array(z.string().min(1)).readonly(),
});

export type UnavailableCapability = z.infer<typeof unavailableCapabilitySchema>;
