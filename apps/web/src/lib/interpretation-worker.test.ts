import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredReading } from "@starguidance/database";

const mocks = vi.hoisted(() => ({
  getRuntimeAdapter: vi.fn(),
  getSystemDatabaseClient: vi.fn(),
  persistenceFor: vi.fn(),
  createInterpretationProvider: vi.fn(),
  claimInterpretationJobs: vi.fn(),
  completeInterpretationJob: vi.fn(),
  failInterpretationJob: vi.fn(),
  markReadingGenerationFailed: vi.fn(),
  writeInterpretationResult: vi.fn(),
  actorTransaction: vi.fn((_client: unknown, _userId: string, work: (tx: unknown) => unknown) =>
    work("synthetic-actor-tx"),
  ),
}));

vi.mock("./runtime", () => ({
  getRuntimeAdapter: mocks.getRuntimeAdapter,
  getSystemDatabaseClient: mocks.getSystemDatabaseClient,
}));

vi.mock("./persistence", () => ({
  persistenceFor: mocks.persistenceFor,
}));

vi.mock("@starguidance/ai", () => ({
  createInterpretationProvider: mocks.createInterpretationProvider,
}));

// Only the members interpretation-worker.ts itself imports — ./persistence and
// ./runtime also import from @starguidance/database, but both are mocked
// wholesale above so their real implementations (and real imports) never run.
vi.mock("@starguidance/database", () => ({
  actorTransaction: mocks.actorTransaction,
  claimInterpretationJobs: mocks.claimInterpretationJobs,
  completeInterpretationJob: mocks.completeInterpretationJob,
  failInterpretationJob: mocks.failInterpretationJob,
  markReadingGenerationFailed: mocks.markReadingGenerationFailed,
  writeInterpretationResult: mocks.writeInterpretationResult,
}));

import { runInterpretationJobs } from "./interpretation-worker";

const userId = "4978a7ef-c4a6-462d-befe-d286a38a772f";
const readingId = "b6a1a6b0-9f8b-4b6a-9f0b-0f2b8b8f9a11";

const JOB = {
  id: "job-1",
  userId,
  readingId,
  attemptCount: 1,
  maxAttempts: 3,
};

// Reuses the same minimal-but-valid shape as
// apps/web/src/lib/repositories/local-integrity.test.ts's own StoredReading
// fixture. traitIndexes is deliberately empty: relevantTraitStatements maps
// over it regardless of whether a profile snapshot was found, so no test here
// needs a real ProfileSnapshot fixture to exercise processJob's other logic.
function reading(): StoredReading {
  return {
    id: readingId,
    userId,
    idempotencyKey: "synthetic-idempotency-key",
    profileSnapshotId: "d1f91755-e7f0-4731-a9c8-79ec9017d78c",
    readingLens: { version: "test-v1", traitIndexes: [] },
    spreadId: "single-focus",
    encryptedQuestion: "encrypted-question",
    safetyClassification: "ordinary",
    draw: {
      id: readingId,
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

// Takes the resolved reading directly (rather than an options object merged
// with ??) so that passing `undefined` for the missing-reading scenario can't
// be silently coerced back to the default fixture.
function stubPersistence(readingSessionsGet: StoredReading | undefined) {
  const getReading = vi.fn().mockResolvedValue(readingSessionsGet);
  const getSnapshot = vi.fn().mockResolvedValue(undefined);
  mocks.persistenceFor.mockReturnValue({
    repositories: {
      readingSessions: { get: getReading },
      profileSnapshots: { get: getSnapshot },
    },
    encrypt: vi.fn((value: string) => value),
    decrypt: vi.fn().mockReturnValue("what does the future hold?"),
  });
  return { getReading, getSnapshot };
}

function stubProvider(generateWithProvenance: ReturnType<typeof vi.fn>) {
  mocks.createInterpretationProvider.mockReturnValue({
    id: "synthetic-provider",
    generate: vi.fn(),
    generateWithProvenance,
    generateFollowUp: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actorTransaction.mockImplementation(
    (_client: unknown, _userId: string, work: (tx: unknown) => unknown) =>
      work("synthetic-actor-tx"),
  );
  mocks.getRuntimeAdapter.mockReturnValue("supabase");
  mocks.getSystemDatabaseClient.mockReturnValue("synthetic-system-client");
  mocks.failInterpretationJob.mockResolvedValue({ terminal: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runInterpretationJobs", () => {
  it("is a no-op on any runtime adapter other than supabase", async () => {
    mocks.getRuntimeAdapter.mockReturnValue("local");

    const summary = await runInterpretationJobs(10);

    expect(summary).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    expect(mocks.getSystemDatabaseClient).not.toHaveBeenCalled();
    expect(mocks.claimInterpretationJobs).not.toHaveBeenCalled();
    expect(mocks.persistenceFor).not.toHaveBeenCalled();
    expect(mocks.createInterpretationProvider).not.toHaveBeenCalled();
  });

  it("claims, generates, writes, and completes a job on the happy path", async () => {
    mocks.claimInterpretationJobs.mockResolvedValue([JOB]);
    stubPersistence(reading());
    const generateWithProvenance = vi.fn().mockResolvedValue({
      result: { cards: [] },
      provenance: { providerId: "synthetic-provider", promptVersion: "v1", schemaVersion: "v1" },
    });
    stubProvider(generateWithProvenance);

    const summary = await runInterpretationJobs(10);

    expect(summary).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(mocks.claimInterpretationJobs).toHaveBeenCalledWith("synthetic-system-client", 10);
    expect(generateWithProvenance).toHaveBeenCalledWith(
      expect.objectContaining({ question: "what does the future hold?" }),
    );
    expect(mocks.actorTransaction).toHaveBeenCalledWith(
      "synthetic-system-client",
      userId,
      expect.any(Function),
    );
    expect(mocks.writeInterpretationResult).toHaveBeenCalledWith("synthetic-actor-tx", {
      userId,
      readingId,
      result: { cards: [] },
      provenance: { providerId: "synthetic-provider", promptVersion: "v1", schemaVersion: "v1" },
    });
    expect(mocks.completeInterpretationJob).toHaveBeenCalledWith("synthetic-system-client", JOB.id);
    expect(mocks.failInterpretationJob).not.toHaveBeenCalled();
    expect(mocks.markReadingGenerationFailed).not.toHaveBeenCalled();
  });

  it("records a transient failure without touching the reading's generation status", async () => {
    mocks.claimInterpretationJobs.mockResolvedValue([JOB]);
    stubPersistence(reading());
    stubProvider(vi.fn().mockRejectedValue(new Error("provider unavailable")));
    mocks.failInterpretationJob.mockResolvedValue({ terminal: false });

    const summary = await runInterpretationJobs(10);

    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mocks.failInterpretationJob).toHaveBeenCalledWith(
      "synthetic-system-client",
      JOB,
      "provider unavailable",
    );
    expect(mocks.writeInterpretationResult).not.toHaveBeenCalled();
    expect(mocks.completeInterpretationJob).not.toHaveBeenCalled();
    expect(mocks.markReadingGenerationFailed).not.toHaveBeenCalled();
  });

  it("marks the reading's generation failed once a job exhausts its retries", async () => {
    mocks.claimInterpretationJobs.mockResolvedValue([JOB]);
    stubPersistence(reading());
    stubProvider(vi.fn().mockRejectedValue(new Error("provider unavailable")));
    mocks.failInterpretationJob.mockResolvedValue({ terminal: true });

    const summary = await runInterpretationJobs(10);

    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mocks.markReadingGenerationFailed).toHaveBeenCalledWith("synthetic-actor-tx", {
      userId,
      readingId,
    });
  });

  it("fails the job without propagating when its reading no longer exists", async () => {
    mocks.claimInterpretationJobs.mockResolvedValue([JOB]);
    stubPersistence(undefined);
    mocks.failInterpretationJob.mockResolvedValue({ terminal: false });

    const summary = await runInterpretationJobs(10);

    expect(summary).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mocks.createInterpretationProvider).not.toHaveBeenCalled();
    expect(mocks.failInterpretationJob).toHaveBeenCalledWith(
      "synthetic-system-client",
      JOB,
      "INTERPRETATION_JOB_READING_MISSING",
    );
    expect(mocks.markReadingGenerationFailed).not.toHaveBeenCalled();
  });
});
