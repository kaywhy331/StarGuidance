import "server-only";

import { randomUUID } from "node:crypto";

import type { BirthProfileInput, ProfileSnapshot } from "@starguidance/contracts";
import { getProfileCompleteness } from "@starguidance/contracts";
import {
  decryptSensitiveWithKeys,
  encryptSensitive,
  type ApplicationRepositories,
  type RepositoryUser,
  type StoredProfileVersion,
} from "@starguidance/database";

import type { ProfileCalculation } from "./profile-engine";
import { getDecryptionKeys, getEncryptionKey, getRepositoriesForUser } from "./runtime";

export interface RequestPersistence {
  repositories: ApplicationRepositories;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export function persistenceFor(user: Pick<RepositoryUser, "id">): RequestPersistence {
  const key = getEncryptionKey();
  const decryptionKeys = getDecryptionKeys();
  return {
    repositories: getRepositoriesForUser(user.id),
    encrypt: (value) => encryptSensitive(value, key),
    decrypt: (value) => decryptSensitiveWithKeys(value, decryptionKeys),
  };
}

export async function saveProfileVersion(
  user: Pick<RepositoryUser, "id">,
  input: BirthProfileInput,
  calculation: ProfileCalculation,
): Promise<ProfileSnapshot> {
  const persistence = persistenceFor(user);
  const active = await persistence.repositories.birthProfiles.getActive(user.id);
  const snapshot: ProfileSnapshot = {
    id: randomUUID(),
    profileId: active?.snapshot.profileId ?? randomUUID(),
    version: (active?.snapshot.version ?? 0) + 1,
    completeness: getProfileCompleteness(input),
    traits: calculation.mappedTraits,
    tensions: calculation.mappedTensions,
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
      status: "pending-certification",
      payload: {
        calculationVersion: calculation.nine_star_ki.algorithm_version,
        interpretationVersion: calculation.nine_star_ki.interpretation_version,
        certificationStatus: calculation.nine_star_ki.certification_status,
        boundaryConvention: calculation.nine_star_ki.boundary_convention,
        thirdStarConvention: calculation.nine_star_ki.third_star_convention,
      },
    },
    ...(
      [
        ["western-astrology", calculation.western_astrology],
        ["bazi", calculation.bazi],
        ["planetary-angularity", calculation.planetary_angularity],
      ] as const
    ).map(([system, component]) => ({
      system,
      status: component.status,
      payload: {
        reason: component.reason,
        calculationVersion: component.calculation_version,
        activationRequirements: component.activation_requirements,
      },
    })),
  ];
  const profile: StoredProfileVersion = {
    encryptedInput: persistence.encrypt(JSON.stringify(input)),
    encryptedCalculations: persistence.encrypt(JSON.stringify(calculation)),
    components,
    snapshot,
  };
  return persistence.repositories.birthProfiles.saveVersion(user.id, profile);
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
