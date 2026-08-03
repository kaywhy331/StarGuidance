import "server-only";

import type { BirthProfileInput, ProfileTension, ProfileTrait } from "@starguidance/contracts";
import { z } from "zod";

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

export type ProfileCalculation = z.infer<typeof calculationSchema> & {
  mappedTraits: ProfileTrait[];
  mappedTensions: ProfileTension[];
};

function toEngineRequest(input: BirthProfileInput) {
  return {
    full_birth_name: input.fullBirthName,
    birth_date: input.birthDate,
    ...(input.birthplace ? { birthplace: input.birthplace } : {}),
    ...(input.birthTime ? { birth_time: input.birthTime } : {}),
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
    const parsed = calculationSchema.safeParse(await response.json());
    // A response that arrived but does not match the agreed contract is a
    // different fault from an unreachable service, and reporting both as
    // "unavailable" sends an operator to check uptime when the payload changed.
    if (!parsed.success) throw new Error("PROFILE_ENGINE_CONTRACT_MISMATCH");
    const calculation = parsed.data;
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
    if (
      error instanceof Error &&
      (error.message === "PROFILE_CALCULATION_REJECTED" ||
        error.message === "PROFILE_ENGINE_CONTRACT_MISMATCH")
    )
      throw error;
    // An abort is this client's own eight-second deadline expiring, which says
    // the service was too slow rather than absent.
    if (error instanceof Error && error.name === "AbortError")
      throw new Error("PROFILE_ENGINE_TIMEOUT");
    throw new Error("PROFILE_ENGINE_UNAVAILABLE");
  } finally {
    clearTimeout(timer);
  }
}
