import { z } from "zod";

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
