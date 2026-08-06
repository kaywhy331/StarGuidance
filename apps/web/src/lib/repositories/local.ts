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
        policy: record.policy,
        version: record.version,
        grantedAt: record.grantedAt,
      }));
    },
    async grant(userId: string, consent: ConsentRecord) {
      const user = localStore.users.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      if (
        !user.consentRecords.some(
          ({ policy, version }) => policy === consent.policy && version === consent.version,
        )
      )
        user.consentRecords.push(consent);
    },
  };

  const birthProfiles = {
    async getActive(userId: string) {
      return localStore.users.get(userId)?.profile;
    },
    async saveVersion(userId: string, profile: StoredProfileVersion) {
      const user = localStore.users.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      const snapshot = {
        ...profile.snapshot,
        profileId: user.profile?.snapshot.profileId ?? profile.snapshot.profileId,
        version: (user.profile?.snapshot.version ?? 0) + 1,
      };
      const storedProfile = { ...profile, snapshot };
      user.profile = storedProfile;
      localStore.profileSnapshots.set(snapshot.id, storedProfile);
      localStore.profileComponents.set(snapshot.id, [
        {
          snapshotId: snapshot.id,
          system: "private-profile-input",
          status: "implemented",
          payload: { envelope: profile.encryptedInput },
        },
        {
          snapshotId: snapshot.id,
          system: "calculation-envelope",
          status: "implemented",
          payload: { envelope: profile.encryptedCalculations },
        },
        ...(profile.components ?? []).map(({ system, status, payload }) => ({
          snapshotId: snapshot.id,
          system,
          status,
          payload,
        })),
      ]);
      localStore.profileTraits.set(
        snapshot.id,
        snapshot.traits.map((trait) => ({ snapshotId: snapshot.id, trait })),
      );
      return snapshot;
    },
    async listVersions(userId: string) {
      const profileId = localStore.users.get(userId)?.profile?.snapshot.profileId;
      return profileId
        ? [...localStore.profileSnapshots.values()].filter(
            (profile) => profile.snapshot.profileId === profileId,
          )
        : [];
    },
    async delete(userId: string) {
      const user = localStore.users.get(userId);
      const profileId = user?.profile?.snapshot.profileId;
      if (!user || !profileId) return false;
      for (const collection of [
        localStore.readings,
        localStore.reports,
        localStore.orders,
        localStore.entitlements,
      ])
        for (const [recordId, value] of collection)
          if (value.userId === userId) collection.delete(recordId);
      for (const [feedbackId, feedback] of localStore.feedback)
        if (feedback.userId === userId) localStore.feedback.delete(feedbackId);
      for (const [snapshotId, profile] of localStore.profileSnapshots)
        if (profile.snapshot.profileId === profileId) {
          localStore.profileSnapshots.delete(snapshotId);
          localStore.profileComponents.delete(snapshotId);
          localStore.profileTraits.delete(snapshotId);
        }
      delete user.profile;
      return true;
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
      const existing = [...localStore.readings.values()].find(
        (candidate) =>
          candidate.userId === reading.userId &&
          candidate.idempotencyKey === reading.idempotencyKey,
      );
      if (existing) return structuredClone(existing);
      localStore.readings.set(reading.id, structuredClone(reading));
      return structuredClone(reading);
    },
    async get(userId: string, readingId: string) {
      return ownedReading(userId, readingId);
    },
    async list(userId: string) {
      return [...localStore.readings.values()].filter((reading) => reading.userId === userId);
    },
    async delete(userId: string, readingId: string) {
      if (!ownedReading(userId, readingId)) return false;
      localStore.readings.delete(readingId);
      for (const [feedbackId, feedback] of localStore.feedback)
        if (feedback.readingId === readingId) localStore.feedback.delete(feedbackId);
      return true;
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
    async save(
      userId: string,
      readingId: string,
      result: StoredReading["result"] & {},
      provenance: NonNullable<StoredReading["outputProvenance"]>,
    ) {
      const reading = ownedReading(userId, readingId);
      if (!reading) throw new Error("READING_NOT_FOUND");
      reading.result = result;
      reading.outputProvenance = provenance;
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
      if (reading.followUps.length > 0) throw new Error("FOLLOW_UP_EXISTS");
      reading.followUps.push(followUp);
    },
  };

  const reports = {
    async get(userId: string, reportId: string) {
      const report = localStore.reports.get(reportId);
      const entitled = [...localStore.entitlements.values()].some(
        (entitlement) =>
          entitlement.userId === userId &&
          entitlement.orderId === report?.orderId &&
          entitlement.status === "active",
      );
      return report?.userId === userId && entitled ? report : undefined;
    },
    async getByOrder(userId: string, orderId: string) {
      const report = [...localStore.reports.values()].find(
        (candidate) => candidate.userId === userId && candidate.orderId === orderId,
      );
      return report ? this.get(userId, report.id) : undefined;
    },
    async create(report: StoredReport) {
      localStore.reports.set(report.id, report);
    },
    async list(userId: string) {
      const result: StoredReport[] = [];
      for (const report of localStore.reports.values()) {
        if (report.userId !== userId) continue;
        const visible = await this.get(userId, report.id);
        if (visible) result.push(visible);
      }
      return result;
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
      const existing = [...localStore.entitlements.values()].find(
        ({ orderId }) => orderId === entitlement.orderId,
      );
      if (existing) return;
      localStore.entitlements.set(entitlement.id, entitlement);
    },
    async revokeByOrder(orderId: string) {
      const entitlement = [...localStore.entitlements.values()].find(
        (candidate) => candidate.orderId === orderId,
      );
      if (entitlement) entitlement.status = "revoked";
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
      async begin(providerEventId: string, eventType: string) {
        const existing = localStore.webhookEvents.get(providerEventId);
        const now = Date.now();
        if (
          existing?.processed ||
          (existing?.processingStartedAt !== undefined &&
            existing.processingStartedAt > now - 5 * 60_000)
        )
          return false;
        localStore.webhookEvents.set(providerEventId, {
          eventType,
          processingStartedAt: now,
          attemptCount: (existing?.attemptCount ?? 0) + 1,
          processed: false,
        });
        return true;
      },
      async complete(providerEventId: string) {
        const event = localStore.webhookEvents.get(providerEventId);
        if (!event) throw new Error("WEBHOOK_EVENT_NOT_FOUND");
        event.processed = true;
        delete event.processingStartedAt;
        delete event.lastFailureCode;
      },
      async fail(providerEventId: string, failureCode: string) {
        const event = localStore.webhookEvents.get(providerEventId);
        if (!event || event.processed) return;
        delete event.processingStartedAt;
        event.lastFailureCode = failureCode;
      },
    },
    audit,
    privacy,
  };
}
