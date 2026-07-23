import "server-only";

import { randomUUID } from "node:crypto";

import type { BirthProfileInput, ProfileSnapshot } from "@starguidance/contracts";
import { getProfileCompleteness } from "@starguidance/contracts";
import {
  decryptSensitive,
  encryptSensitive,
  type ApplicationRepositories,
  type RepositoryUser,
  type StoredProfileVersion,
} from "@starguidance/database";

import type { ProfileCalculation } from "./profile-engine";
import { getEncryptionKey, getRepositoriesForUser } from "./runtime";

export interface RequestPersistence {
  repositories: ApplicationRepositories;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export function persistenceFor(user: Pick<RepositoryUser, "id">): RequestPersistence {
  const key = getEncryptionKey();
  return {
    repositories: getRepositoriesForUser(user.id),
    encrypt: (value) => encryptSensitive(value, key),
    decrypt: (value) => decryptSensitive(value, key),
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
      westernAstrology: "unavailable",
      bazi: "unavailable",
    },
    createdAt: new Date().toISOString(),
  };
  const profile: StoredProfileVersion = {
    encryptedInput: persistence.encrypt(JSON.stringify(input)),
    encryptedCalculations: persistence.encrypt(JSON.stringify(calculation)),
    snapshot,
    maskedName: `${input.fullBirthName.slice(0, 1)}${"•".repeat(Math.min(input.fullBirthName.length - 1, 8))}`,
    birthDate: input.birthDate,
    timeKind: input.birthTime.kind,
    ...(input.birthplace
      ? { birthplaceLabel: `${input.birthplace.city}, ${input.birthplace.countryCode}` }
      : {}),
  };
  await persistence.repositories.birthProfiles.saveVersion(user.id, profile);
  return snapshot;
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
