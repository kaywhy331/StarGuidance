import "server-only";

import { randomUUID } from "node:crypto";

import type { BirthProfileInput, ProfileSnapshot, ProfileTrait } from "@starguidance/contracts";
import { getProfileCompleteness } from "@starguidance/contracts";
import {
  decryptSensitiveWithKeys,
  encryptSensitive,
  type ApplicationRepositories,
  type RepositoryUser,
  type StoredProfileVersion,
  type StoredRelationshipProfileVersion,
} from "@starguidance/database";

import type { ProfileCalculation } from "./profile-engine";
import { getDecryptionKeys, getEncryptionKey, getRepositoriesForUser } from "./runtime";

/**
 * The classes of sensitive data this application encrypts. Envelope AAD is
 * `<class>:<owner user id>` (migration-free — the binding lives in the
 * ciphertext, see @starguidance/database's encryption module), so a
 * database-level splice across users or across classes fails authentication.
 * Classes are purposes, not physical columns, because the profile-input
 * envelope is deliberately stored in both birth_profiles and the
 * private-profile-input component row.
 */
export type SensitiveDataClass =
  | "profile-input"
  | "profile-calculations"
  | "related-person-profile-input"
  | "related-person-profile-calculations"
  | "related-person-reading-lens"
  | "reading-question"
  | "draw-ceremony"
  | "draw-server-seed"
  | "follow-up-question"
  | "feedback-comment"
  | "report-source";

export function encryptionAadContext(dataClass: SensitiveDataClass, userId: string): string {
  return `${dataClass}:${userId}`;
}

export interface RequestPersistence {
  repositories: ApplicationRepositories;
  encrypt(value: string, dataClass: SensitiveDataClass): string;
  decrypt(value: string, dataClass: SensitiveDataClass): string;
}

export function filterProfileOntologyBySystem(
  calculation: Pick<ProfileCalculation, "mappedTraits" | "mappedTensions" | "mappedConvergences">,
  enabledSystems: readonly ProfileTrait["sourceSystem"][],
) {
  const enabled = new Set(enabledSystems);
  const retainedIndexes = new Map<number, number>();
  const traits = calculation.mappedTraits.filter((trait, index) => {
    if (!enabled.has(trait.sourceSystem)) return false;
    retainedIndexes.set(index, retainedIndexes.size);
    return true;
  });
  const tensions = calculation.mappedTensions.flatMap((tension) => {
    const [first, second] = tension.traitIndexes.map((index) => retainedIndexes.get(index));
    return first === undefined || second === undefined
      ? []
      : [{ ...tension, traitIndexes: [first, second] as [number, number] }];
  });
  const convergences = calculation.mappedConvergences.flatMap((convergence) => {
    const traitIndexes = convergence.traitIndexes.flatMap((index) => {
      const retained = retainedIndexes.get(index);
      return retained === undefined ? [] : [retained];
    });
    const sourceSystems = convergence.sourceSystems.filter((system) => enabled.has(system));
    return traitIndexes.length < 2 || new Set(sourceSystems).size < 2
      ? []
      : [{ ...convergence, traitIndexes, sourceSystems }];
  });
  return { traits, tensions, convergences };
}

export function persistenceFor(user: Pick<RepositoryUser, "id">): RequestPersistence {
  const key = getEncryptionKey();
  const decryptionKeys = getDecryptionKeys();
  return {
    repositories: getRepositoriesForUser(user.id),
    encrypt: (value, dataClass) =>
      encryptSensitive(value, key, encryptionAadContext(dataClass, user.id)),
    decrypt: (value, dataClass) =>
      decryptSensitiveWithKeys(value, decryptionKeys, encryptionAadContext(dataClass, user.id)),
  };
}

const DEFAULT_PROFILE_SYSTEMS: readonly ProfileTrait["sourceSystem"][] = [
  "numerology",
  "dreamspell",
  "westernAstrology",
  "bazi",
  "planetaryAngularity",
  "nineStarKi",
];

function buildStoredProfileVersion(
  persistence: RequestPersistence,
  input: BirthProfileInput,
  calculation: ProfileCalculation,
  enabledSystems: readonly ProfileTrait["sourceSystem"][],
  profileId: string,
  version: number,
  inputClass: "profile-input" | "related-person-profile-input",
  calculationClass: "profile-calculations" | "related-person-profile-calculations",
): StoredProfileVersion {
  const enabled = new Set(enabledSystems);
  const { traits, tensions, convergences } = filterProfileOntologyBySystem(
    calculation,
    enabledSystems,
  );
  const snapshot: ProfileSnapshot = {
    id: randomUUID(),
    profileId,
    version,
    completeness: getProfileCompleteness(input),
    ontologyVersion: calculation.ontology_version,
    traits,
    tensions,
    convergences,
    enabledSystems,
    calculationVersions: {
      numerology: calculation.numerology.algorithm_version,
      dreamspell: calculation.dreamspell.algorithm_version,
      nineStarKi: calculation.nine_star_ki.algorithm_version,
      westernAstrology: calculation.western_astrology.calculation_version,
      bazi: calculation.bazi.calculation_version,
      planetaryAngularity: calculation.planetary_angularity.calculation_version,
    },
    createdAt: new Date().toISOString(),
  };
  const components: NonNullable<StoredProfileVersion["components"]> = [
    {
      system: "nine-star-ki",
      status: enabled.has("nineStarKi") ? "pending-certification" : "unavailable",
      payload: enabled.has("nineStarKi")
        ? {
            calculationVersion: calculation.nine_star_ki.algorithm_version,
            interpretationVersion: calculation.nine_star_ki.interpretation_version,
            certificationStatus: calculation.nine_star_ki.certification_status,
            boundaryConvention: calculation.nine_star_ki.boundary_convention,
            thirdStarConvention: calculation.nine_star_ki.third_star_convention,
          }
        : { reason: "disabled_by_feature_flag" },
    },
    ...(
      [
        ["western-astrology", calculation.western_astrology],
        ["bazi", calculation.bazi],
        ["planetary-angularity", calculation.planetary_angularity],
      ] as const
    ).map(([system, component]) => {
      const sourceSystem =
        system === "western-astrology"
          ? "westernAstrology"
          : system === "planetary-angularity"
            ? "planetaryAngularity"
            : "bazi";
      if (!enabled.has(sourceSystem))
        return {
          system,
          status: "unavailable" as const,
          payload: { reason: "disabled_by_feature_flag" },
        };
      return {
        system,
        status:
          component.status === "available" ? ("implemented" as const) : ("unavailable" as const),
        payload:
          component.status === "available"
            ? {
                calculationVersion: component.calculation_version,
                evidence: component.evidence,
                uncertainty: component.uncertainty,
              }
            : {
                reason: component.reason,
                calculationVersion: component.calculation_version,
                activationRequirements: component.activation_requirements,
              },
      };
    }),
  ];
  const profile: StoredProfileVersion = {
    encryptedInput: persistence.encrypt(JSON.stringify(input), inputClass),
    encryptedCalculations: persistence.encrypt(JSON.stringify(calculation), calculationClass),
    components,
    snapshot,
  };
  return profile;
}

export async function saveProfileVersion(
  user: Pick<RepositoryUser, "id">,
  input: BirthProfileInput,
  calculation: ProfileCalculation,
  enabledSystems: readonly ProfileTrait["sourceSystem"][] = DEFAULT_PROFILE_SYSTEMS,
): Promise<ProfileSnapshot> {
  const persistence = persistenceFor(user);
  const active = await persistence.repositories.birthProfiles.getActive(user.id);
  const profile = buildStoredProfileVersion(
    persistence,
    input,
    calculation,
    enabledSystems,
    active?.snapshot.profileId ?? randomUUID(),
    (active?.snapshot.version ?? 0) + 1,
    "profile-input",
    "profile-calculations",
  );
  return persistence.repositories.birthProfiles.saveVersion(user.id, profile);
}

export async function saveRelationshipProfileVersion(
  user: Pick<RepositoryUser, "id">,
  input: BirthProfileInput,
  calculation: ProfileCalculation,
  enabledSystems: readonly ProfileTrait["sourceSystem"][] = DEFAULT_PROFILE_SYSTEMS,
  existing?: StoredRelationshipProfileVersion,
): Promise<ProfileSnapshot> {
  const persistence = persistenceFor(user);
  const relationshipProfileId = existing?.relationshipProfileId ?? randomUUID();
  const profile = buildStoredProfileVersion(
    persistence,
    input,
    calculation,
    enabledSystems,
    relationshipProfileId,
    (existing?.snapshot.version ?? 0) + 1,
    "related-person-profile-input",
    "related-person-profile-calculations",
  );
  return persistence.repositories.relationshipProfiles.saveVersion(user.id, {
    ...profile,
    relationshipProfileId,
  });
}

export async function recordAudit(
  userId: string,
  action: string,
  targetType: string,
  targetId: string = userId,
): Promise<void> {
  await getRepositoriesForUser(userId).audit.record({
    userId,
    action,
    targetType,
    targetId,
    metadata: {},
  });
}

/**
 * Best-effort security-event audit rows (PRD ACC-008): sign-in, sign-out,
 * password change. Never blocks the auth action itself — an identity that
 * signs in before it was ever provisioned has no users row for the audit
 * foreign key, and failing authentication because an audit row could not be
 * written would turn an audit hiccup into a lockout. Account deletion is
 * deliberately NOT recorded here: audit_events cascade away with the user,
 * so its durable record is the deletion receipt (migration 0010).
 */
export async function recordSecurityAudit(
  userId: string | undefined,
  action: "auth.signed_in" | "auth.signed_out" | "auth.password_changed",
): Promise<void> {
  if (!userId) return;
  try {
    await recordAudit(userId, action, "account", userId);
  } catch {
    // Not yet provisioned, or the audit write failed — the auth action must
    // proceed either way; this helper is the only intentionally lossy writer.
  }
}
