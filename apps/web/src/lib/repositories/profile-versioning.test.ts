import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DeterministicFallbackProvider, classifyQuestionContext } from "@starguidance/ai";
import { CALCULATION_SYSTEM_VERSIONS, type ProfileSnapshot } from "@starguidance/contracts";
import type { StoredProfileVersion, StoredReading } from "@starguidance/database";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import { localStore } from "../local-store";
import { persistenceFor } from "../persistence";
import { storedReadingLensStatements, storedReadingSnapshot } from "../stored-reading-lens";

const userId = "00000000-0000-4000-8000-000000000006";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
});
afterEach(() => {
  for (const value of Object.values(localStore)) if (value instanceof Map) value.clear();
  vi.unstubAllEnvs();
});

it("retains a reading's historical snapshot, lens and output after time/place and calculation-version updates", async () => {
  const persistence = persistenceFor({ id: userId });
  const repo = persistence.repositories;
  await repo.users.ensure({ id: userId, email: "reference@example.test" });
  const profileId = randomUUID();
  const version = (
    completeness: ProfileSnapshot["completeness"],
    legacy: boolean,
  ): StoredProfileVersion => ({
    encryptedInput: persistence.encrypt(
      JSON.stringify({
        fullBirthName: "Ada Lovelace",
        birthDate: "1987-07-26",
        ...(completeness === "complete" ? { birthplace: "London", birthTime: "08:15" } : {}),
      }),
      "profile-input",
    ),
    // The old value is a synthetic historical envelope, not a rerun of the retired engine.
    encryptedCalculations: persistence.encrypt(
      JSON.stringify({ life_path: legacy ? 4 : 22 }),
      "profile-calculations",
    ),
    snapshot: {
      id: randomUUID(),
      profileId,
      version: 99,
      completeness,
      ontologyVersion: "profile-traits-v4",
      traits: [
        {
          domain: "workStyle",
          statement: legacy
            ? "Historical synthetic observation."
            : "Updated synthetic observation.",
          sourceSystem: "numerology",
          sourceRule: "synthetic-versioning-example",
          calculationVersion: legacy ? "pythagorean-v2" : "pythagorean-v3",
          stability: "stable",
          direction: "mixed",
          strength: 0.5,
          confidence: "medium",
          lifeDomains: ["career"],
        },
      ],
      tensions: [],
      convergences: [],
      calculationVersions: {
        ...CALCULATION_SYSTEM_VERSIONS,
        ...(legacy
          ? { numerology: "pythagorean-v2", dreamspell: "dreamspell-anchor-1987-07-26-kin34-v1" }
          : {}),
      },
      createdAt: "2026-10-15T00:00:00.000Z",
    },
  });
  const old = await repo.birthProfiles.saveVersion(userId, version("core", true));
  const oldStored = structuredClone(await repo.profileSnapshots.get(userId, old.id));
  const spread = spreads.find(({ id }) => id === "three-card")!;
  const draw = createLockedDraw({ cards: tarotCards, deckVersion: DECK_VERSION, spread });
  const configuration = {
    version: "reading-configuration-v1" as const,
    reversalMode: "reversals_enabled" as const,
    personalizationMode: "personalized_tarot" as const,
    positions: spread.positions,
    capabilities: spread.capabilities!,
  };
  const question = "What should I consider about my work?";
  const questionClassification = classifyQuestionContext(question);
  const output = await new DeterministicFallbackProvider().generateWithProvenance({
    draw,
    configuration,
    question,
    questionClassification,
    relevantTraitStatements: [old.traits[0]!.statement],
  });
  const reading: StoredReading = {
    id: draw.id,
    userId,
    idempotencyKey: randomUUID(),
    profileSnapshotId: old.id,
    readingLens: { version: "question-trait-lens-v2", traitIndexes: [0], tensionIndexes: [] },
    questionClassification,
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
    spreadId: spread.id,
    configuration,
    encryptedQuestion: persistence.encrypt(question, "reading-question"),
    safetyClassification: "ordinary",
    draw,
    generationStatus: "ready",
    result: output.result,
    outputProvenance: output.provenance,
    followUps: [],
    createdAt: draw.lockedAt,
    expiresAt: "2026-10-16T00:00:00.000Z",
  };
  await repo.readingSessions.createLocked(reading);
  const locked = structuredClone(await repo.readingSessions.get(userId, reading.id));
  const current = await repo.birthProfiles.saveVersion(userId, version("complete", false));
  expect(current.version).toBe(2);
  expect(old.version).toBe(1);
  expect(current.profileId).toBe(old.profileId);
  expect(current.id).not.toBe(old.id);
  expect((await repo.birthProfiles.getActive(userId))?.snapshot).toEqual(current);
  expect(await repo.profileSnapshots.get(userId, old.id)).toEqual(oldStored);
  expect(await repo.readingSessions.get(userId, reading.id)).toEqual(locked);
  expect(await storedReadingSnapshot(persistence, userId, reading)).toEqual(old);
  expect(
    storedReadingLensStatements(reading, await storedReadingSnapshot(persistence, userId, reading)),
  ).toEqual(["Historical synthetic observation."]);
  expect(storedReadingLensStatements(reading, current)).toEqual(["Updated synthetic observation."]);
  expect(
    await storedReadingSnapshot(persistence, userId, { profileSnapshotId: current.id }),
  ).toEqual(current);
  expect(await repo.profileSnapshots.get(randomUUID(), old.id)).toBeUndefined();
  expect(persistence.decrypt(oldStored!.encryptedCalculations, "profile-calculations")).toBe(
    '{"life_path":4}',
  );
  expect(
    (await repo.birthProfiles.listVersions(userId)).map(({ snapshot }) => snapshot.version),
  ).toEqual([1, 2]);
});
