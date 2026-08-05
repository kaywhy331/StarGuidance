import { z } from "zod";

const unavailableCalculationSchema = z.object({
  status: z.literal("unavailable"),
  capability: z.string().min(1),
  reason: z.string().min(1),
  calculation_version: z.string().min(1),
  activation_requirements: z.array(z.string().min(1)).min(1),
});

const nineStarKiStarSchema = z.object({
  number: z.number().int().min(1).max(9),
  phase: z.enum(["water", "earth", "wood", "metal", "fire"]),
});

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
  nine_star_ki: z.object({
    principal_star: nineStarKiStarSchema,
    character_star: nineStarKiStarSchema,
    energy_star: nineStarKiStarSchema,
    boundary_convention: z.string().min(1),
    third_star_convention: z.string().min(1),
    algorithm_version: z.string().min(1),
    interpretation_version: z.string().min(1),
    certification_status: z.string().min(1),
  }),
  western_astrology: unavailableCalculationSchema,
  bazi: unavailableCalculationSchema,
  planetary_angularity: unavailableCalculationSchema,
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
      source_system: z.enum([
        "numerology",
        "dreamspell",
        "westernAstrology",
        "bazi",
        "planetaryAngularity",
        "nineStarKi",
      ]),
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
