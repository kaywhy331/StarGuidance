import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import {
  type AuditRecord,
  type ProfileComponentRecord,
  type ProfileTraitRecord,
  type RepositoryUser,
  type StoredEntitlement,
  type StoredOrder,
  type StoredProfileVersion,
  type StoredReading,
  type StoredReport,
} from "@starguidance/database";

export type {
  StoredEntitlement,
  StoredOrder,
  StoredReading,
  StoredReport,
} from "@starguidance/database";

export type LocalProfileVersion = StoredProfileVersion;

export interface LocalUser extends RepositoryUser {
  profile?: LocalProfileVersion;
  consentRecords: { version: string; grantedAt: string }[];
}

export interface LocalStore {
  key: string;
  sessions: Map<string, string>;
  users: Map<string, LocalUser>;
  usersByEmail: Map<string, string>;
  readings: Map<string, StoredReading>;
  reports: Map<string, StoredReport>;
  orders: Map<string, StoredOrder>;
  entitlements: Map<string, StoredEntitlement>;
  settings: Map<string, { displayName: string; soundEnabled: boolean; reducedMotion: boolean }>;
  profileComponents: Map<string, ProfileComponentRecord[]>;
  profileTraits: Map<string, ProfileTraitRecord[]>;
  feedback: Map<string, { userId: string; readingId: string }>;
  profileSnapshots: Map<string, LocalProfileVersion>;
  idempotency: Map<string, string>;
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
    entitlements: new Map(),
    settings: new Map(),
    profileComponents: new Map(),
    profileTraits: new Map(),
    feedback: new Map(),
    profileSnapshots: new Map(),
    idempotency: new Map(),
    auditEvents: [],
  });

export function assertLocalAdapter(): void {
  const netlifyContext = process.env.CONTEXT;
  const localEnvironment = process.env.APP_ENV === "development" || process.env.APP_ENV === "test";
  if (
    process.env.RUNTIME_ADAPTER !== "local" ||
    process.env.ALLOW_LOCAL_RUNTIME_ADAPTER !== "true" ||
    !localEnvironment ||
    (netlifyContext !== undefined && netlifyContext !== "dev")
  )
    throw new Error(
      "The local adapter requires explicit authorization and is disabled outside local development/test.",
    );
}

export function createLocalSession(email: string): { token: string; user: LocalUser } {
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
  const token = randomBytes(32).toString("base64url");
  localStore.sessions.set(token, userId);
  return { token, user: localStore.users.get(userId) as LocalUser };
}

export function getLocalUser(token: string | undefined): LocalUser | undefined {
  if (!token) return undefined;
  const id = localStore.sessions.get(token);
  return id ? localStore.users.get(id) : undefined;
}
