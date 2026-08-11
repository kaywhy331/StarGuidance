import "server-only";

import type {
  BirthProfileInput,
  ProfileConvergence,
  ProfileTension,
  ProfileTrait,
} from "@starguidance/contracts";

import { calculationSchema } from "./profile-engine-contract";
import { findServiceUrlProblem } from "./service-url";

export type ProfileCalculation = import("zod").z.infer<typeof calculationSchema> & {
  mappedTraits: ProfileTrait[];
  mappedTensions: ProfileTension[];
  mappedConvergences: ProfileConvergence[];
};

function toEngineRequest(input: BirthProfileInput) {
  return {
    full_birth_name: input.fullBirthName,
    birth_date: input.birthDate,
    ...(input.birthplace ? { birthplace: input.birthplace } : {}),
    ...(input.birthTime ? { birth_time: input.birthTime } : {}),
  };
}

/**
 * Resolves the engine's base address.
 *
 * A configured value carrying a trailing slash produced `//v1/profile/compute`,
 * which the service answers with 404 while the health check — which normalised
 * the same value before using it — went on reporting the dependency healthy.
 * Normalising in one place and not the other is what let a broken deployment
 * look green, so this is now the only way either of them builds a request.
 */
export function profileEngineBaseUrl(): string {
  const configured = process.env.PROFILE_ENGINE_URL?.trim() || "http://127.0.0.1:8000";
  const normalised = configured.replace(/\/+$/, "");
  // Localhost in development is http, so only inspect shape for absolute https.
  if (normalised.startsWith("https://") && findServiceUrlProblem("PROFILE_ENGINE_URL", normalised))
    throw new Error("PROFILE_ENGINE_MISCONFIGURED");
  return normalised;
}

async function attemptCalculation(
  input: BirthProfileInput,
  deadlineMs: number,
): Promise<ProfileCalculation> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const response = await fetch(`${profileEngineBaseUrl()}/v1/profile/compute`, {
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
    });
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
        direction: trait.direction,
        strength: trait.strength,
        confidence: trait.confidence,
        lifeDomains: trait.life_domains,
      })),
      mappedTensions: calculation.tensions.map((tension) => ({
        id: tension.id,
        sideA: tension.side_a,
        sideB: tension.side_b,
        traitIndexes: tension.trait_indexes,
        lifeDomains: tension.life_domains,
      })),
      mappedConvergences: calculation.convergences.map((convergence) => ({
        id: convergence.id,
        domain: convergence.domain,
        summary: convergence.summary,
        traitIndexes: convergence.trait_indexes,
        sourceSystems: convergence.source_systems,
        confidence: convergence.confidence,
      })),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "PROFILE_CALCULATION_REJECTED" ||
        error.message === "PROFILE_ENGINE_CONTRACT_MISMATCH" ||
        error.message === "PROFILE_ENGINE_MISCONFIGURED")
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

/**
 * The first attempt's deadline, kept short so a healthy service answers fast.
 */
const FIRST_ATTEMPT_MS = 8_000;

/**
 * The second attempt's deadline. A suspended instance takes far longer to
 * answer its first request than a running one takes to answer any request.
 */
const WAKE_ATTEMPT_MS = 25_000;

/** Faults that describe the request, not the service, and must not be retried. */
const PERMANENT_FAULTS = new Set([
  "PROFILE_CALCULATION_REJECTED",
  "PROFILE_ENGINE_CONTRACT_MISMATCH",
  "PROFILE_ENGINE_MISCONFIGURED",
]);

/**
 * Calculates a profile, retrying once when the service was merely too slow.
 *
 * A staging instance that suspends when idle cannot answer its first request
 * inside the deadline a running instance needs, so the first person to arrive
 * after an idle period was told the calculation could not complete — while
 * their request was the very thing waking the service. Retrying succeeded,
 * which is what the message advised, but only for someone willing to try again.
 *
 * The computation is a pure function of the birth details and writes nothing,
 * so repeating it is safe. Only a slow or unreachable service is retried: a
 * rejected input, a changed contract and a misconfigured address are all
 * properties of the request or the deployment, and repeating them would just
 * cost the person more waiting.
 */
export async function calculateProfile(input: BirthProfileInput): Promise<ProfileCalculation> {
  try {
    return await attemptCalculation(input, FIRST_ATTEMPT_MS);
  } catch (error) {
    if (error instanceof Error && PERMANENT_FAULTS.has(error.message)) throw error;
    return attemptCalculation(input, WAKE_ATTEMPT_MS);
  }
}
