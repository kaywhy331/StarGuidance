import "server-only";

import type { BirthProfileInput, ProfileTension, ProfileTrait } from "@starguidance/contracts";
import { z } from "zod";

const calculationSchema = z.object({
  completeness: z.enum(["core", "locationEnhanced", "approximateTime", "complete"]),
  numerology: z.object({
    life_path: z.number().int().positive(),
    expression: z.number().int().positive(),
    soul_urge: z.number().int().nonnegative(),
    personality: z.number().int().nonnegative(),
    birthday: z.number().int().positive(),
    name_rendering: z.string(),
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

export type ProfileCalculation = z.infer<typeof calculationSchema> & {
  mappedTraits: ProfileTrait[];
  mappedTensions: ProfileTension[];
};

function toEngineRequest(input: BirthProfileInput) {
  return {
    full_birth_name: input.fullBirthName,
    birth_date: input.birthDate,
    ...(input.birthplace
      ? {
          birthplace: {
            city: input.birthplace.city,
            region: input.birthplace.region,
            country_code: input.birthplace.countryCode,
            time_zone: input.birthplace.timeZone,
          },
        }
      : {}),
    ...(input.authoritativeTimeZone
      ? { authoritative_time_zone: input.authoritativeTimeZone }
      : {}),
    birth_time:
      input.birthTime.kind === "exact"
        ? { kind: "exact", exact: input.birthTime.time }
        : input.birthTime.kind === "approximate"
          ? { kind: "approximate", start: input.birthTime.start, end: input.birthTime.end }
          : { kind: "unknown" },
    ...(input.latinNameRendering ? { latin_name_rendering: input.latinNameRendering } : {}),
  };
}

export async function calculateProfile(input: BirthProfileInput): Promise<ProfileCalculation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(
      `${process.env.PROFILE_ENGINE_URL ?? "http://127.0.0.1:8000"}/v1/profile/compute`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.PROFILE_ENGINE_SHARED_SECRET
            ? { authorization: `Bearer ${process.env.PROFILE_ENGINE_SHARED_SECRET}` }
            : {}),
        },
        body: JSON.stringify(toEngineRequest(input)),
        cache: "no-store",
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      if (response.status === 422) throw new Error("PROFILE_CALCULATION_REJECTED");
      throw new Error("PROFILE_ENGINE_UNAVAILABLE");
    }
    const calculation = calculationSchema.parse(await response.json());
    return {
      ...calculation,
      mappedTraits: calculation.traits.map((trait) => ({
        domain: trait.domain,
        statement: trait.statement,
        sourceSystem: trait.source_system,
        sourceRule: trait.source_rule,
        calculationVersion: trait.calculation_version,
        stability: trait.stability,
      })),
      mappedTensions: calculation.tensions.map((tension) => ({
        id: tension.id,
        sideA: tension.side_a,
        sideB: tension.side_b,
        traitIndexes: tension.trait_indexes,
      })),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_CALCULATION_REJECTED") throw error;
    throw new Error("PROFILE_ENGINE_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}
