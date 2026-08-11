import {
  baziResultSchema,
  CALCULATION_SYSTEM_VERSIONS,
  planetaryAngularityResultSchema,
  westernAstrologyResultSchema,
} from "@starguidance/contracts";
import { z } from "zod";

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
  completeness: z.enum(["core", "locationEnhanced", "complete"]),
  ontology_version: z.literal("profile-traits-v4"),
  numerology: z.object({
    name_calculation_status: z.enum(["available", "unavailable"]),
    life_path: z.number().int().positive(),
    expression: z.number().int().positive().nullable(),
    soul_urge: z.number().int().nonnegative().nullable(),
    personality: z.number().int().nonnegative().nullable(),
    birthday: z.number().int().positive(),
    name_rendering: z.string().nullable(),
    transformation: z.string(),
    algorithm_version: z.literal(CALCULATION_SYSTEM_VERSIONS.numerology),
  }),
  dreamspell: z.object({
    kin: z.number().int().min(1).max(260),
    tone: z.number().int().min(1).max(13),
    tone_name: z.string(),
    solar_seal: z.number().int().min(1).max(20),
    solar_seal_name: z.string(),
    color: z.string(),
    algorithm_version: z.literal(CALCULATION_SYSTEM_VERSIONS.dreamspell),
    certification_status: z.string(),
  }),
  nine_star_ki: z.object({
    principal_star: nineStarKiStarSchema,
    character_star: nineStarKiStarSchema,
    energy_star: nineStarKiStarSchema,
    boundary_convention: z.string().min(1),
    third_star_convention: z.string().min(1),
    algorithm_version: z.literal(CALCULATION_SYSTEM_VERSIONS.nineStarKi),
    interpretation_version: z.string().min(1),
    certification_status: z.string().min(1),
  }),
  // These discriminated unions deliberately accept a fully evidenced
  // available result as well as today's fail-closed unavailable envelope.
  // Activation therefore cannot bypass validation by swapping `unknown` into
  // the response when a reviewed adapter eventually ships.
  western_astrology: westernAstrologyResultSchema,
  bazi: baziResultSchema,
  planetary_angularity: planetaryAngularityResultSchema,
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
      direction: z.enum(["supportive", "challenging", "mixed"]),
      strength: z.number().min(0).max(1),
      confidence: z.enum(["low", "medium", "high"]),
      life_domains: z
        .array(z.enum(["general", "career", "relationships", "change", "creativity"]))
        .min(1),
    }),
  ),
  tensions: z.array(
    z.object({
      id: z.string(),
      side_a: z.string(),
      side_b: z.string(),
      trait_indexes: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
      life_domains: z
        .array(z.enum(["general", "career", "relationships", "change", "creativity"]))
        .min(1),
    }),
  ),
  convergences: z.array(
    z.object({
      id: z.string(),
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
      summary: z.string().min(1),
      trait_indexes: z.array(z.number().int().nonnegative()).min(2),
      source_systems: z
        .array(
          z.enum([
            "numerology",
            "dreamspell",
            "westernAstrology",
            "bazi",
            "planetaryAngularity",
            "nineStarKi",
          ]),
        )
        .min(2),
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
});
