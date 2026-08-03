import { z } from "zod";

/**
 * The response contract the application enforces on the profile engine.
 *
 * Kept apart from the client on purpose: the client is server-only, and the
 * staging verification suite needs this schema to check that the deployed
 * engine still satisfies it. Importing the client into Playwright pulls in
 * `server-only` and fails the whole suite at collection.
 */
export const calculationSchema = z.object({
  completeness: z.enum(["core", "locationEnhanced", "approximateTime", "complete"]),
  numerology: z.object({
    name_calculation_status: z.enum(["available", "unavailable"]),
    life_path: z.number().int().positive(),
    expression: z.number().int().positive().nullable(),
    soul_urge: z.number().int().nonnegative().nullable(),
    personality: z.number().int().nonnegative().nullable(),
    birthday: z.number().int().positive(),
    name_rendering: z.string().nullable(),
    transformation: z.string(),
    algorithm_version: z.string(),
  }),
  dreamspell: z.object({
    kin: z.number().int().min(1).max(260),
    tone: z.number().int().min(1).max(13),
    tone_name: z.string(),
    solar_seal: z.number().int().min(1).max(20),
    solar_seal_name: z.string(),
    color: z.string(),
    algorithm_version: z.string(),
    certification_status: z.string(),
  }),
  western_astrology: z.object({
    status: z.literal("unavailable"),
    capability: z.string(),
    reason: z.string(),
    activation_requirements: z.array(z.string()),
  }),
  bazi: z.object({
    status: z.literal("unavailable"),
    capability: z.string(),
    reason: z.string(),
    activation_requirements: z.array(z.string()),
  }),
  traits: z.array(
    z.object({
      domain: z.enum([
        "coreMotivation",
        "emotionalProcessing",
        "communicationStyle",
        "decisionStyle",
        "socialOrientation",
        "relationshipNeeds",
        "riskOrientation",
        "stabilityVsChange",
        "conflictResponse",
        "workStyle",
        "creativeExpression",
        "repeatingTension",
        "growthLever",
      ]),
      statement: z.string(),
      source_system: z.enum(["numerology", "dreamspell", "westernAstrology", "bazi"]),
      source_rule: z.string(),
      calculation_version: z.string(),
      stability: z.enum(["stable", "uncertain", "unavailable"]),
    }),
  ),
  tensions: z.array(
    z.object({
      id: z.string(),
      side_a: z.string(),
      side_b: z.string(),
      trait_indexes: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    }),
  ),
});
