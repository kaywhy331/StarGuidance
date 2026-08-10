import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStore } from "../local-store";
import { createLocalRepositories } from "./local";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
  localStore.orders.clear();
  localStore.reportSources.clear();
  localStore.entitlements.clear();
  localStore.reports.clear();
  localStore.webhookEvents.clear();
  localStore.users.clear();
  localStore.profileSnapshots.clear();
  localStore.readings.clear();
  localStore.feedback.clear();
});

afterEach(() => vi.unstubAllEnvs());

describe("local commerce repositories", () => {
  it("withholds a report as soon as its entitlement is revoked", async () => {
    const repositories = createLocalRepositories();
    const userId = "4978a7ef-c4a6-462d-befe-d286a38a772f";
    const orderId = "476c3147-cd8e-4465-a409-5fddc0c056ab";
    await repositories.entitlements.grant({
      id: "0b9123c5-f01f-401a-b9da-13ae48d64282",
      userId,
      snapshotId: "d1f91755-e7f0-4731-a9c8-79ec9017d78c",
      orderId,
      status: "active",
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    await repositories.reports.create({
      id: "2ddbf701-6bda-4bc6-882f-41a7695ff0ef",
      userId,
      snapshotId: "d1f91755-e7f0-4731-a9c8-79ec9017d78c",
      orderId,
      provider: "local",
      status: "ready",
      sections: [],
      createdAt: "2026-08-04T00:00:00.000Z",
    });

    expect(await repositories.reports.getByOrder(userId, orderId)).toBeDefined();
    await repositories.entitlements.revokeByOrder(orderId);
    expect(await repositories.reports.getByOrder(userId, orderId)).toBeUndefined();
    expect(await repositories.reports.list(userId)).toEqual([]);
    expect(await repositories.reports.listForExport(userId)).toHaveLength(1);
  });

  it("releases failed claims, leases concurrent work, and completes once", async () => {
    const events = createLocalRepositories().webhookEvents;
    expect(await events.begin("evt_replay", "checkout.session.completed")).toBe(true);
    expect(await events.begin("evt_replay", "checkout.session.completed")).toBe(false);
    await events.fail("evt_replay", "processing_failed");
    expect(await events.begin("evt_replay", "checkout.session.completed")).toBe(true);
    await events.complete("evt_replay");
    expect(await events.begin("evt_replay", "checkout.session.completed")).toBe(false);
    expect(localStore.webhookEvents.get("evt_replay")?.attemptCount).toBe(2);
  });

  it("keeps paid commerce when the private profile is deleted", async () => {
    const repositories = createLocalRepositories();
    const userId = "4978a7ef-c4a6-462d-befe-d286a38a772f";
    const profileId = "d9b556ef-514d-4908-a3a4-271633a57ae5";
    const snapshotId = "d1f91755-e7f0-4731-a9c8-79ec9017d78c";
    const orderId = "476c3147-cd8e-4465-a409-5fddc0c056ab";
    const profile = {
      encryptedInput: "encrypted-input",
      encryptedCalculations: "encrypted-calculations",
      snapshot: {
        id: snapshotId,
        profileId,
        version: 1,
        completeness: "core" as const,
        traits: [],
        tensions: [],
        calculationVersions: {},
        createdAt: "2026-08-04T00:00:00.000Z",
      },
    };
    localStore.users.set(userId, {
      id: userId,
      email: "commerce-retention@example.invalid",
      createdAt: "2026-08-04T00:00:00.000Z",
      consentRecords: [],
      profile,
    });
    localStore.profileSnapshots.set(snapshotId, profile);
    await repositories.orders.create({
      id: orderId,
      userId,
      snapshotId,
      provider: "local",
      providerSessionId: `local:${orderId}`,
      idempotencyKey: "synthetic-local-order-key",
      status: "paid",
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    await repositories.entitlements.grant({
      id: "0b9123c5-f01f-401a-b9da-13ae48d64282",
      userId,
      snapshotId,
      orderId,
      status: "active",
      createdAt: "2026-08-04T00:00:00.000Z",
    });
    await repositories.reports.create({
      id: "2ddbf701-6bda-4bc6-882f-41a7695ff0ef",
      userId,
      snapshotId,
      orderId,
      provider: "local",
      status: "ready",
      sections: [{ key: "overview", title: "Overview", body: "Retained product." }],
      createdAt: "2026-08-04T00:00:00.000Z",
    });

    expect(await repositories.birthProfiles.delete(userId)).toBe(true);

    expect((await repositories.orders.get(userId, orderId))?.snapshotId).toBeNull();
    expect((await repositories.entitlements.list(userId))[0]?.snapshotId).toBeNull();
    expect((await repositories.reports.listForExport(userId))[0]).toMatchObject({
      snapshotId: null,
      sections: [{ body: "Retained product." }],
    });
  });
});
