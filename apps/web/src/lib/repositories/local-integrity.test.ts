import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeterministicFallbackProvider } from "@starguidance/ai";
import type { StoredReading } from "@starguidance/database";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";

import { storedGuestReading } from "../guest-reading-server";
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
    configuration: {
      version: "reading-configuration-v1",
      reversalMode: "reversals_enabled",
      personalizationMode: "pure_tarot",
      positions: [],
      capabilities: {
        trajectoryPositionIds: [],
        alternativePositionGroups: [],
        timingMethod: null,
        linkedPositions: [],
      },
    },
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

async function savedGuestReading(owner = userId): Promise<StoredReading> {
  const spread = spreads.find(({ id }) => id === "one-card")!;
  const configuration = {
    version: "reading-configuration-v1" as const,
    reversalMode: "reversals_enabled" as const,
    personalizationMode: "personalized_tarot" as const,
    positions: spread.positions,
    capabilities: spread.capabilities!,
  };
  const draw = createLockedDraw({ cards: tarotCards, deckVersion: DECK_VERSION, spread });
  const questionClassification = {
    version: "question-classification-v1" as const,
    topic: "general" as const,
    horizon: "open" as const,
    intent: "clarity" as const,
    generalReading: false,
  };
  const readerLens = ["You tend to trust what you can build steadily."];
  const generated = await new DeterministicFallbackProvider().generateWithProvenance({
    draw,
    configuration,
    question: "What deserves my attention now?",
    questionClassification,
    relevantTraitStatements: readerLens,
  });
  return storedGuestReading({
    userId: owner,
    receipt: {
      version: "guest-reading-receipt-v2",
      readingId: draw.id,
      question: "What deserves my attention now?",
      questionClassification,
      configuration,
      readerLens,
      draw,
      result: generated.result,
      provenance: generated.provenance,
      createdAt: draw.lockedAt,
      expiresAt: new Date(Date.parse(draw.lockedAt) + 7 * 86_400_000).toISOString(),
    },
    encryptedQuestion: "encrypted-guest-question",
    safetyClassification: "ordinary",
  });
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

  it("saves a guest reading once per account and never into two histories", async () => {
    const sessions = createLocalRepositories().readingSessions;
    const guest = await savedGuestReading();

    const first = await sessions.importGuestReading(guest);
    const replay = await sessions.importGuestReading({ ...guest, followUps: [] });

    expect(first).toMatchObject({ id: guest.id, source: "guest_trial", profileSnapshotId: null });
    expect(first.generationStatus).toBe("ready");
    expect(replay).toEqual(first);
    expect(await sessions.getByIdempotencyKey(userId, guest.idempotencyKey)).toEqual(first);
    expect(
      await sessions.getByIdempotencyKey(
        "00000000-0000-4000-8000-0000000000ff",
        guest.idempotencyKey,
      ),
    ).toBeUndefined();
    await expect(
      sessions.importGuestReading({ ...guest, userId: "00000000-0000-4000-8000-0000000000ff" }),
    ).rejects.toThrow("GUEST_READING_SAVED_ELSEWHERE");
  });

  it("refuses a guest save shaped like an account reading or missing its interpretation", async () => {
    const sessions = createLocalRepositories().readingSessions;
    const guest = await savedGuestReading();
    const withoutResult: StoredReading = { ...guest };
    delete withoutResult.result;

    await expect(
      sessions.importGuestReading({
        ...guest,
        profileSnapshotId: "d1f91755-e7f0-4731-a9c8-79ec9017d78c",
      }),
    ).rejects.toThrow("GUEST_READING_IMPORT_INVALID");
    await expect(sessions.importGuestReading(withoutResult)).rejects.toThrow(
      "GUEST_READING_IMPORT_INVALID",
    );
    expect(localStore.readings.size).toBe(0);
  });

  it("keeps a saved guest reading when the private profile is deleted", async () => {
    const repositories = createLocalRepositories();
    await repositories.users.ensure({ id: userId, email: "reader@example.test" });
    await repositories.birthProfiles.saveVersion(userId, {
      encryptedInput: "encrypted-profile",
      encryptedCalculations: "encrypted-calculations",
      snapshot: {
        id: "00000000-0000-4000-8000-00000000000b",
        profileId: "00000000-0000-4000-8000-00000000000c",
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
    const guest = await repositories.readingSessions.importGuestReading(await savedGuestReading());
    await repositories.feedback.create({
      userId,
      readingId: guest.id,
      kind: "experience",
      resonance: 5,
    });

    expect(await repositories.birthProfiles.delete(userId)).toBe(true);
    expect((await repositories.readingSessions.list(userId)).map(({ id }) => id)).toEqual([
      guest.id,
    ]);
    expect(await repositories.feedback.list(userId, guest.id)).toHaveLength(1);
  });
});
