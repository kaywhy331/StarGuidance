import { z } from "zod";

export const featureFlagSchema = z.object({
  westernAstrology: z.boolean().default(false),
  bazi: z.boolean().default(false),
  aiSynthesis: z.boolean().default(false),
  stripePayments: z.boolean().default(false),
});

export type FeatureFlags = z.infer<typeof featureFlagSchema>;
