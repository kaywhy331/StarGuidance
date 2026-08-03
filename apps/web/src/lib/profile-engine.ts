import "server-only";

import type { BirthProfileInput, ProfileTension, ProfileTrait } from "@starguidance/contracts";

import { calculationSchema } from "./profile-engine-contract";

export type ProfileCalculation = import("zod").z.infer<typeof calculationSchema> & {
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
