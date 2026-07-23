import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import type { BirthProfileInput, ProfileSnapshot, ReadingResult } from "@starguidance/contracts";
import { getProfileCompleteness } from "@starguidance/contracts";
import { decryptSensitive, encryptSensitive } from "@starguidance/database";
import type { LockedDraw } from "@starguidance/tarot-domain";
import type { ProfileCalculation } from "./profile-engine";

export interface LocalProfileVersion {
  encryptedInput: string;
  encryptedCalculations: string;
  snapshot: ProfileSnapshot;
  maskedName: string;
  birthDate: string;
  timeKind: BirthProfileInput["birthTime"]["kind"];
  birthplaceLabel?: string;
}

export interface LocalUser {
  id: string;
  email: string;
  profile?: LocalProfileVersion;
  consentRecords: { version: string; grantedAt: string }[];
}

export interface StoredReading {
  id: string;
  userId: string;
  profileSnapshotId: string;
  readingLens: { version: string; traitIndexes: readonly number[] };
  spreadId: string;
  encryptedQuestion: string;
  draw: LockedDraw;
  result?: ReadingResult;
  generationStatus: "pending" | "ready" | "failed";
  followUps: { id: string; encryptedQuestion: string; result: ReadingResult }[];
  createdAt: string;
}

export interface StoredReport {
  id: string;
  userId: string;
  snapshotId: string;
  orderId: string;
  status: "ready";
  sections: { key: string; title: string; body: string; unavailable?: boolean }[];
  createdAt: string;
}

export interface StoredOrder {
  id: string;
  userId: string;
  snapshotId: string;
  provider: "local" | "stripe";
  providerSessionId?: string;
  status: "pending" | "paid";
  createdAt: string;
}

export interface StoredEntitlement {
  id: string;
  userId: string;
  snapshotId: string;
  orderId: string;
  createdAt: string;
}

interface LocalStore {
  key: string;
  sessions: Map<string, string>;
  users: Map<string, LocalUser>;
  usersByEmail: Map<string, string>;
  readings: Map<string, StoredReading>;
  reports: Map<string, StoredReport>;
  orders: Map<string, StoredOrder>;
  entitlements: Map<string, StoredEntitlement>;
  profileSnapshots: Map<string, LocalProfileVersion>;
  idempotency: Map<string, string>;
  auditEvents: { type: string; userId: string; subjectId?: string; createdAt: string }[];
}

const globalStore = globalThis as typeof globalThis & { __starGuidanceLocalStore?: LocalStore };

export const localStore: LocalStore =
  globalStore.__starGuidanceLocalStore ??
  (globalStore.__starGuidanceLocalStore = {
    key: randomBytes(32).toString("base64"),
    sessions: new Map(),
    users: new Map(),
    usersByEmail: new Map(),
    readings: new Map(),
    reports: new Map(),
    orders: new Map(),
    entitlements: new Map(),
    profileSnapshots: new Map(),
    idempotency: new Map(),
    auditEvents: [],
  });

export function assertLocalAdapter(): void {
  if (process.env.APP_ENV === "production") {
    throw new Error("The local adapter is disabled in production. Configure Supabase/Postgres.");
  }
}

export function createLocalSession(email: string): { token: string; user: LocalUser } {
  assertLocalAdapter();
  const normalized = email.trim().toLowerCase();
  let userId = localStore.usersByEmail.get(normalized);
  if (!userId) {
    userId = randomUUID();
    localStore.usersByEmail.set(normalized, userId);
    localStore.users.set(userId, { id: userId, email: normalized, consentRecords: [] });
  }
  const token = randomBytes(32).toString("base64url");
  localStore.sessions.set(token, userId);
  return { token, user: localStore.users.get(userId) as LocalUser };
}

export function getLocalUser(token: string | undefined): LocalUser | undefined {
  if (!token) return undefined;
  const id = localStore.sessions.get(token);
  return id ? localStore.users.get(id) : undefined;
}

export function saveLocalProfile(
  user: LocalUser,
  input: BirthProfileInput,
  calculation: ProfileCalculation,
): ProfileSnapshot {
  const version = (user.profile?.snapshot.version ?? 0) + 1;
  const snapshot: ProfileSnapshot = {
    id: randomUUID(),
    profileId: user.profile?.snapshot.profileId ?? randomUUID(),
    version,
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
  const profile: LocalProfileVersion = {
    encryptedInput: encryptSensitive(JSON.stringify(input), localStore.key),
    encryptedCalculations: encryptSensitive(JSON.stringify(calculation), localStore.key),
    snapshot,
    maskedName: `${input.fullBirthName.slice(0, 1)}${"•".repeat(Math.min(input.fullBirthName.length - 1, 8))}`,
    birthDate: input.birthDate,
    timeKind: input.birthTime.kind,
    ...(input.birthplace
      ? { birthplaceLabel: `${input.birthplace.city}, ${input.birthplace.countryCode}` }
      : {}),
  };
  user.profile = profile;
  localStore.profileSnapshots.set(snapshot.id, profile);
  return snapshot;
}

export function encryptLocal(value: string): string {
  return encryptSensitive(value, localStore.key);
}

export function decryptLocal(value: string): string {
  return decryptSensitive(value, localStore.key);
}

export function recordAudit(type: string, userId: string, subjectId?: string): void {
  localStore.auditEvents.push({
    type,
    userId,
    ...(subjectId ? { subjectId } : {}),
    createdAt: new Date().toISOString(),
  });
}
