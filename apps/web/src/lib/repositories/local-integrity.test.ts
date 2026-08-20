import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredReading } from "@starguidance/database";

import { localStore } from "../local-store";
import { createLocalRepositories } from "./local";

const userId = "4978a7ef-c4a6-462d-befe-d286a38a772f";

function reading(id: string, idempotencyKey: string): StoredReading {
  return {
    id,
    userId,
    idempotencyKey,
    profileSnapshotId: "d1f91755-e7f0-4731-a9c8-79ec9017d78c",
    readingLens: { version: "test-v1", traitIndexes: [] },
    questionClassification: {
      version: "question-classification-v1",
      topic: "general",
      horizon: "open",
      intent: "clarity",
      generalReading: false,
    },
    entitlementDecision: {
      version: "reading-entitlement-v1",
      mode: "unlimited",
      outcome: "granted",
      entitlementClass: "standard",
      used: 0,
      limit: null,
      remaining: null,
      windowStartsAt: null,
      windowEndsAt: null,
    },
    expiresAt: "2026-08-12T00:00:00.000Z",
    spreadId: "single-focus",
    encryptedQuestion: "encrypted-question",
    safetyClassification: "ordinary",
    draw: {
      id,
      deckVersion: "test-deck-v1",
      spreadId: "single-focus",
      spreadVersion: "test-spread-v1",
      shuffleVersion: "secure-fisher-yates-v1",
      assignments: [],
      lockedAt: "2026-08-05T00:00:00.000Z",
    },
    generationStatus: "pending",
    followUps: [],
    createdAt: "2026-08-05T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
  localStore.readings.clear();
  localStore.users.clear();
  localStore.usersByEmail.clear();
  localStore.profileSnapshots.clear();
  localStore.profileComponents.clear();
  localStore.profileTraits.clear();
  localStore.feedback.clear();
});

afterEach(() => vi.unstubAllEnvs());

describe("local integrity parity", () => {
  it("returns the original locked draw when a reading request is replayed", async () => {
    const sessions = createLocalRepositories().readingSessions;
    const first = await sessions.createLocked(
      reading("00000000-0000-4000-8000-000000000001", "same-request"),
    );
    const replay = await sessions.createLocked(
      reading("00000000-0000-4000-8000-000000000002", "same-request"),
    );

    expect(replay.id).toBe(first.id);
    expect(localStore.readings.size).toBe(1);
  });

  it("enforces the configured follow-up limit and permits a larger policy", async () => {
    const repositories = createLocalRepositories();
    const stored = await repositories.readingSessions.createLocked(
      reading("00000000-0000-4000-8000-000000000003", "follow-up-request"),
    );
    const first = {
      id: "00000000-0000-4000-8000-000000000004",
      encryptedQuestion: "encrypted-follow-up",
      result: { response: "First response" },
      outputProvenance: {
        providerId: "deterministic-fallback-v1",
        promptVersion: "deterministic-fallback-v3",
        contentVersion: "starguidance-original-v1",
        safetyPolicyVersion: "question-safety-v2",
        schemaVersion: "follow-up-result-v1",
      },
      createdAt: "2026-08-05T00:01:00.000Z",
    };
    await repositories.followUps.create(userId, stored.id, first, { limit: 2 });

    await repositories.followUps.create(
      userId,
      stored.id,
      { ...first, id: "00000000-0000-4000-8000-000000000005" },
      { limit: 2 },
    );

    await expect(
      repositories.followUps.create(
        userId,
        stored.id,
        {
          ...first,
          id: "00000000-0000-4000-8000-00000000000a",
        },
        { limit: 2 },
      ),
    ).rejects.toThrow("FOLLOW_UP_LIMIT_REACHED");
  });

  it("deletes one owned reading without affecting the account", async () => {
    const repositories = createLocalRepositories();
    await repositories.users.ensure({ id: userId, email: "reader@example.test" });
    const stored = await repositories.readingSessions.createLocked(
      reading("00000000-0000-4000-8000-000000000006", "delete-reading"),
    );

    expect(await repositories.readingSessions.delete(userId, stored.id)).toBe(true);
    expect(await repositories.readingSessions.get(userId, stored.id)).toBeUndefined();
    expect(await repositories.users.get(userId)).toBeDefined();
  });

  it("deletes the profile lineage and dependent readings but preserves the login", async () => {
    const repositories = createLocalRepositories();
    await repositories.users.ensure({ id: userId, email: "reader@example.test" });
    const snapshot = await repositories.birthProfiles.saveVersion(userId, {
      encryptedInput: "encrypted-profile",
      encryptedCalculations: "encrypted-calculations",
      snapshot: {
        id: "00000000-0000-4000-8000-000000000007",
        profileId: "00000000-0000-4000-8000-000000000008",
        version: 1,
        completeness: "core",
        ontologyVersion: "profile-traits-v4",
        traits: [],
        tensions: [],
        convergences: [],
        calculationVersions: {
          numerology: "test-v1",
          dreamspell: "test-v1",
          nineStarKi: "test-v1",
          westernAstrology: "test-v1",
          bazi: "test-v1",
          planetaryAngularity: "test-v1",
        },
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    });
    const dependent = reading("00000000-0000-4000-8000-000000000009", "profile-dependent-reading");
    dependent.profileSnapshotId = snapshot.id;
    await repositories.readingSessions.createLocked(dependent);

    expect(await repositories.birthProfiles.delete(userId)).toBe(true);
    expect(await repositories.birthProfiles.getActive(userId)).toBeUndefined();
    expect(await repositories.readingSessions.list(userId)).toEqual([]);
    expect(await repositories.users.get(userId)).toBeDefined();
  });
});
