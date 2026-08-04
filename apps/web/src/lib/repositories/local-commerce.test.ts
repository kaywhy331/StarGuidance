import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { localStore } from "../local-store";
import { createLocalRepositories } from "./local";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
  localStore.orders.clear();
  localStore.entitlements.clear();
  localStore.reports.clear();
  localStore.webhookEvents.clear();
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
      status: "ready",
      sections: [],
      createdAt: "2026-08-04T00:00:00.000Z",
    });

    expect(await repositories.reports.getByOrder(userId, orderId)).toBeDefined();
    await repositories.entitlements.revokeByOrder(orderId);
    expect(await repositories.reports.getByOrder(userId, orderId)).toBeUndefined();
    expect(await repositories.reports.list(userId)).toEqual([]);
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
});
