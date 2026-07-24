import "server-only";

import { randomUUID } from "node:crypto";

import type {
  ApplicationRepositories,
  AuditRecord,
  ConsentRecord,
  ProfileComponentRecord,
  ProfileTraitRecord,
  RepositoryUser,
  StoredEntitlement,
  StoredFollowUp,
  StoredOrder,
  StoredProfileVersion,
  StoredReading,
  StoredReport,
  UserSettingsRecord,
} from "@starguidance/database";

import { assertLocalAdapter, localStore } from "../local-store";

function ownedReading(userId: string, readingId: string): StoredReading | undefined {
  const reading = localStore.readings.get(readingId);
  return reading?.userId === userId ? reading : undefined;
}

function ownedProfile(userId: string, snapshotId: string): StoredProfileVersion | undefined {
  const user = localStore.users.get(userId);
  const profile = localStore.profileSnapshots.get(snapshotId);
  return profile && profile.snapshot.profileId === user?.profile?.snapshot.profileId
    ? profile
    : undefined;
}

export function createLocalRepositories(): ApplicationRepositories {
  assertLocalAdapter();
  const users = {
    async ensure(input: Pick<RepositoryUser, "id" | "email">) {
      const existing = localStore.users.get(input.id);
      if (existing) return existing;
      const user = {
        ...input,
        createdAt: new Date().toISOString(),
        consentRecords: [],
      };
      localStore.users.set(user.id, user);
      localStore.usersByEmail.set(user.email, user.id);
      return user;
    },
    async get(userId: string) {
      return localStore.users.get(userId);
    },
    async delete(userId: string) {
      localStore.users.delete(userId);
    },
  };

  const settings = {
    async get(userId: string) {
      const value = localStore.settings.get(userId);
      return value ? { userId, ...value } : undefined;
    },
    async upsert(record: UserSettingsRecord) {
      localStore.settings.set(record.userId, {
        displayName: record.displayName,
        soundEnabled: record.soundEnabled,
        reducedMotion: record.reducedMotion,
      });
    },
  };

  const consents = {
    async list(userId: string): Promise<ConsentRecord[]> {
      return (localStore.users.get(userId)?.consentRecords ?? []).map((record) => ({
        policy: "privacy-reflective",
        version: record.version,
        grantedAt: record.grantedAt,
      }));
    },
    async grant(userId: string, consent: ConsentRecord) {
      const user = localStore.users.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      if (!user.consentRecords.some(({ version }) => version === consent.version))
        user.consentRecords.push({ version: consent.version, grantedAt: consent.grantedAt });
    },
  };

  const birthProfiles = {
    async getActive(userId: string) {
      return localStore.users.get(userId)?.profile;
    },
    async saveVersion(userId: string, profile: StoredProfileVersion) {
      const user = localStore.users.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      user.profile = profile;
      localStore.profileSnapshots.set(profile.snapshot.id, profile);
      localStore.profileComponents.set(profile.snapshot.id, [
        {
          snapshotId: profile.snapshot.id,
          system: "private-profile-input",
          status: "implemented",
          payload: { envelope: profile.encryptedInput },
        },
        {
          snapshotId: profile.snapshot.id,
          system: "calculation-envelope",
          status: "implemented",
          payload: { envelope: profile.encryptedCalculations },
        },
      ]);
      localStore.profileTraits.set(
        profile.snapshot.id,
        profile.snapshot.traits.map((trait) => ({ snapshotId: profile.snapshot.id, trait })),
      );
    },
    async listVersions(userId: string) {
      const profileId = localStore.users.get(userId)?.profile?.snapshot.profileId;
      return profileId
        ? [...localStore.profileSnapshots.values()].filter(
            (profile) => profile.snapshot.profileId === profileId,
          )
        : [];
    },
  };

  const profileSnapshots = {
    async get(userId: string, snapshotId: string) {
      return ownedProfile(userId, snapshotId);
    },
    async list(userId: string) {
      return (await birthProfiles.listVersions(userId)).map(({ snapshot }) => snapshot);
    },
  };

  const profileComponents = {
    async list(userId: string, snapshotId: string): Promise<ProfileComponentRecord[]> {
      return ownedProfile(userId, snapshotId)
        ? (localStore.profileComponents.get(snapshotId) ?? [])
        : [];
    },
  };

  const traits = {
    async list(userId: string, snapshotId: string): Promise<ProfileTraitRecord[]> {
      return ownedProfile(userId, snapshotId)
        ? (localStore.profileTraits.get(snapshotId) ?? [])
        : [];
    },
  };

  const readingSessions = {
    async createLocked(reading: StoredReading) {
      localStore.readings.set(reading.id, structuredClone(reading));
    },
    async get(userId: string, readingId: string) {
      return ownedReading(userId, readingId);
    },
    async list(userId: string) {
      return [...localStore.readings.values()].filter((reading) => reading.userId === userId);
    },
    async setGenerationStatus(
      userId: string,
      readingId: string,
      status: StoredReading["generationStatus"],
    ) {
      const reading = ownedReading(userId, readingId);
      if (!reading) throw new Error("READING_NOT_FOUND");
      reading.generationStatus = status;
    },
  };

  const lockedDraws = {
    async get(userId: string, readingId: string) {
      return ownedReading(userId, readingId)?.draw;
    },
  };

  const outputs = {
    async save(userId: string, readingId: string, result: StoredReading["result"] & {}) {
      const reading = ownedReading(userId, readingId);
      if (!reading) throw new Error("READING_NOT_FOUND");
      reading.result = result;
      reading.generationStatus = "ready";
    },
    async latest(userId: string, readingId: string) {
      return ownedReading(userId, readingId)?.result;
    },
  };

  const followUps = {
    async list(userId: string, readingId: string) {
      return ownedReading(userId, readingId)?.followUps ?? [];
    },
    async create(userId: string, readingId: string, followUp: StoredFollowUp) {
      const reading = ownedReading(userId, readingId);
      if (!reading) throw new Error("READING_NOT_FOUND");
      reading.followUps.push(followUp);
    },
  };

  const reports = {
    async get(userId: string, reportId: string) {
      const report = localStore.reports.get(reportId);
      return report?.userId === userId ? report : undefined;
    },
    async create(report: StoredReport) {
      localStore.reports.set(report.id, report);
    },
    async list(userId: string) {
      return [...localStore.reports.values()].filter((report) => report.userId === userId);
    },
  };

  const orders = {
    async create(order: StoredOrder) {
      localStore.orders.set(order.id, order);
      localStore.idempotency.set(`${order.userId}:${order.idempotencyKey}`, order.id);
    },
    async get(userId: string, orderId: string) {
      const order = localStore.orders.get(orderId);
      return order?.userId === userId ? order : undefined;
    },
    async getByIdempotencyKey(userId: string, key: string) {
      const id = localStore.idempotency.get(`${userId}:${key}`);
      return id ? this.get(userId, id) : undefined;
    },
    async getByProviderSession(providerSessionId: string) {
      return [...localStore.orders.values()].find(
        (order) => order.providerSessionId === providerSessionId,
      );
    },
    async setStatus(orderId: string, status: StoredOrder["status"]) {
      const order = localStore.orders.get(orderId);
      if (!order) throw new Error("ORDER_NOT_FOUND");
      order.status = status;
    },
    async list(userId: string) {
      return [...localStore.orders.values()].filter((order) => order.userId === userId);
    },
  };

  const entitlements = {
    async grant(entitlement: StoredEntitlement) {
      localStore.entitlements.set(entitlement.id, entitlement);
    },
    async list(userId: string) {
      return [...localStore.entitlements.values()].filter(
        (entitlement) => entitlement.userId === userId,
      );
    },
  };

  const audit = {
    async record(record: Omit<AuditRecord, "createdAt">) {
      localStore.auditEvents.push({ ...record, createdAt: new Date().toISOString() });
    },
    async list(userId: string) {
      return localStore.auditEvents.filter((event) => event.userId === userId);
    },
  };

  const privacy = {
    async export(userId: string) {
      const user = await users.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      const storedSettings = await settings.get(userId);
      return {
        user,
        ...(storedSettings ? { settings: storedSettings } : {}),
        consents: await consents.list(userId),
        profiles: await birthProfiles.listVersions(userId),
        readings: await readingSessions.list(userId),
        reports: await reports.list(userId),
        orders: await orders.list(userId),
        entitlements: await entitlements.list(userId),
        auditEvents: await audit.list(userId),
      };
    },
    async deleteAccount(userId: string) {
      const user = localStore.users.get(userId);
      if (!user) return;
      for (const collection of [
        localStore.readings,
        localStore.reports,
        localStore.orders,
        localStore.entitlements,
      ])
        for (const [id, value] of collection) if (value.userId === userId) collection.delete(id);
      for (const [id, profile] of localStore.profileSnapshots)
        if (profile.snapshot.profileId === user.profile?.snapshot.profileId) {
          localStore.profileSnapshots.delete(id);
          localStore.profileComponents.delete(id);
          localStore.profileTraits.delete(id);
        }
      for (const [token, id] of localStore.sessions)
        if (id === userId) localStore.sessions.delete(token);
      localStore.settings.delete(userId);
      localStore.usersByEmail.delete(user.email);
      localStore.auditEvents = localStore.auditEvents.filter((event) => event.userId !== userId);
      localStore.users.delete(userId);
    },
  };

  return {
    users,
    settings,
    consents,
    birthProfiles,
    profileSnapshots,
    profileComponents,
    traits,
    readingSessions,
    lockedDraws,
    outputs,
    followUps,
    history: { listReadings: readingSessions.list },
    feedback: {
      async create(input) {
        if (!ownedReading(input.userId, input.readingId)) throw new Error("READING_NOT_FOUND");
        const id = randomUUID();
        localStore.feedback.set(id, { userId: input.userId, readingId: input.readingId });
        return id;
      },
    },
    reports,
    orders,
    entitlements,
    webhookEvents: {
      async begin(providerEventId: string) {
        const key = `webhook:${providerEventId}`;
        if (localStore.idempotency.has(key)) return false;
        localStore.idempotency.set(key, "pending");
        return true;
      },
      async complete(providerEventId: string) {
        localStore.idempotency.set(`webhook:${providerEventId}`, "complete");
      },
    },
    audit,
    privacy,
  };
}
