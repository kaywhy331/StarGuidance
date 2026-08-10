import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import {
  type AuditRecord,
  type ProfileComponentRecord,
  type ProfileTraitRecord,
  type RepositoryUser,
  type StoredEntitlement,
  type StoredFeedback,
  type StoredOrder,
  type StoredProfileVersion,
  type StoredReading,
  type StoredReport,
} from "@starguidance/database";

import { isLocalRuntimeAdapterAuthorized } from "./hosted-runtime";

export type {
  StoredEntitlement,
  StoredFeedback,
  StoredOrder,
  StoredReading,
  StoredReport,
} from "@starguidance/database";

export type LocalProfileVersion = StoredProfileVersion;

export interface LocalUser extends RepositoryUser {
  profile?: LocalProfileVersion;
  consentRecords: { policy: string; version: string; grantedAt: string }[];
}

export interface LocalStore {
  key: string;
  sessions: Map<string, string>;
  users: Map<string, LocalUser>;
  usersByEmail: Map<string, string>;
  readings: Map<string, StoredReading>;
  reports: Map<string, StoredReport>;
  orders: Map<string, StoredOrder>;
  reportSources: Map<string, string>;
  entitlements: Map<string, StoredEntitlement>;
  settings: Map<string, { displayName: string; soundEnabled: boolean; reducedMotion: boolean }>;
  profileComponents: Map<string, ProfileComponentRecord[]>;
  profileTraits: Map<string, ProfileTraitRecord[]>;
  feedback: Map<string, StoredFeedback>;
  profileSnapshots: Map<string, LocalProfileVersion>;
  idempotency: Map<string, string>;
  webhookEvents: Map<
    string,
    {
      eventType: string;
      processingStartedAt?: number;
      attemptCount: number;
      processed: boolean;
      lastFailureCode?: string;
    }
  >;
  auditEvents: AuditRecord[];
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
    reportSources: new Map(),
    entitlements: new Map(),
    settings: new Map(),
    profileComponents: new Map(),
    profileTraits: new Map(),
    feedback: new Map(),
    profileSnapshots: new Map(),
    idempotency: new Map(),
    webhookEvents: new Map(),
    auditEvents: [],
  });

export function assertLocalAdapter(): void {
  if (!isLocalRuntimeAdapterAuthorized())
    throw new Error(
      "The local adapter requires explicit authorization and is disabled outside local development/test.",
    );
}

export function createLocalSession(
  email: string,
  policyReceipts: readonly { policy: string; version: string; acceptedAt: string }[] = [],
): { token: string; user: LocalUser } {
  assertLocalAdapter();
  const normalized = email.trim().toLowerCase();
  let userId = localStore.usersByEmail.get(normalized);
  if (!userId) {
    userId = randomUUID();
    localStore.usersByEmail.set(normalized, userId);
    localStore.users.set(userId, {
      id: userId,
      email: normalized,
      createdAt: new Date().toISOString(),
      consentRecords: [],
    });
  }
  const user = localStore.users.get(userId);
  if (!user) throw new Error("USER_NOT_FOUND");
  for (const receipt of policyReceipts)
    if (
      !user.consentRecords.some(
        ({ policy, version }) => policy === receipt.policy && version === receipt.version,
      )
    )
      user.consentRecords.push({
        policy: receipt.policy,
        version: receipt.version,
        grantedAt: receipt.acceptedAt,
      });
  const token = randomBytes(32).toString("base64url");
  localStore.sessions.set(token, userId);
  return { token, user };
}

export function getLocalUser(token: string | undefined): LocalUser | undefined {
  if (!token) return undefined;
  const id = localStore.sessions.get(token);
  return id ? localStore.users.get(id) : undefined;
}
