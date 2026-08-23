import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFollowUp: vi.fn(),
  createInterpretationProvider: vi.fn(),
  getReading: vi.fn(),
  getRuntimeConfiguration: vi.fn(),
  getSnapshot: vi.fn(),
}));

vi.mock("@starguidance/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@starguidance/ai")>()),
  createInterpretationProvider: mocks.createInterpretationProvider,
}));
vi.mock("@starguidance/database", () => ({
  actorTransaction: vi.fn(),
  reenqueueInterpretationJob: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  assertCurrentPolicyConsents: vi.fn(),
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
  requireUser: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000911",
    email: "reader@example.test",
  })),
}));
vi.mock("@/lib/interpretation-worker", () => ({ runInterpretationJobs: vi.fn() }));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: vi.fn(() => "encrypted-follow-up"),
    decrypt: vi.fn(() => "Original question"),
    repositories: {
      feedback: { list: vi.fn(async () => []) },
      followUps: { create: mocks.createFollowUp },
      profileSnapshots: { get: mocks.getSnapshot },
      readingSessions: { get: mocks.getReading },
    },
  }),
  recordAudit: vi.fn(),
}));
vi.mock("@/lib/product-telemetry", () => ({ tryRecordProductEvent: vi.fn() }));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  requestSecurityFailure: () => undefined,
}));
vi.mock("@/lib/runtime", () => ({
  getRuntimeAdapter: () => "local",
  getSystemDatabaseClient: vi.fn(),
}));
vi.mock("@/lib/runtime-configuration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-configuration")>()),
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
}));

import { POST } from "./route";

const readingId = "00000000-0000-4000-8000-000000000912";
const lockedDraw = {
  id: "00000000-0000-4000-8000-000000000913",
  deckVersion: "starguidance-illustrated-v3",
  spreadId: "one-card",
  spreadVersion: "one-card-v2",
  shuffleVersion: "fisher-yates-csprng-v1",
  lockedAt: "2026-08-20T00:00:00.000Z",
  assignments: [{ positionId: "focus", cardId: "major-00", orientation: "upright", order: 0 }],
};
const configuration = {
  version: "reading-configuration-v1" as const,
  reversalMode: "reversals_enabled" as const,
  personalizationMode: "pure_tarot" as const,
  positions: [
    {
      id: "focus",
      displayName: "Focus",
      interpretiveFunction: "the concentrated center of the reading",
      description: "The central focus.",
      order: 0,
      placement: { column: 0, row: 0, rotation: 0, layer: 0 },
    },
  ],
  capabilities: {
    trajectoryPositionIds: [],
    alternativePositionGroups: [],
    timingMethod: null,
    linkedPositions: [],
  },
};
const originalResult = {
  schemaVersion: "reading-result-v3" as const,
  directAnswer: "The current pattern suggests one grounded step.",
  overallPattern: "Focus stays with observable action.",
  cards: [
    {
      positionId: "focus",
      positionLabel: "Focus",
      cardId: "major-00",
      orientation: "upright" as const,
      coreMeaning: "A willing beginning.",
      positionInterpretation: "The Focus position holds a willing beginning.",
      relationshipNotes: [],
      supportingEvidence: ["The Fool upright in Focus."],
    },
  ],
  synthesis: "The beginning becomes useful through one reversible action.",
  likelyTrajectory: null,
  alternatePath: null,
  timing: null,
  userAgency: "Choose one observable next step.",
  reflectionPrompt: "What can begin without certainty?",
  uncertaintyNote: "This reading is conditional and does not guarantee an outcome.",
  personalizationLens: null,
  safetyFlags: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeConfiguration.mockResolvedValue({
    content: { tarotContentVersion: "starguidance-original-v1" },
    commerce: { followUpLimit: 3 },
    models: {
      liveAiEnabled: false,
      primaryModel: "openai/gpt-oss-120b",
      fallbackModels: [],
      disabledModels: [],
    },
    prompts: { bundleId: "reader-voice-v3", safetyPolicyVersion: "question-safety-v2" },
  });
  mocks.getReading.mockResolvedValue({
    id: readingId,
    userId: "00000000-0000-4000-8000-000000000911",
    profileSnapshotId: "00000000-0000-4000-8000-000000000914",
    questionClassification: {
      version: "question-classification-v1",
      topic: "change",
      horizon: "open",
      intent: "clarity",
      generalReading: false,
    },
    readingLens: { version: "reading-lens-v1", traitIndexes: [], tensionIndexes: [] },
    configuration,
    encryptedQuestion: "encrypted-question",
    draw: lockedDraw,
    result: originalResult,
    ritualProgress: {
      version: "ritual-progress-v2",
      phase: "followUpAvailable",
      cutIndex: 0,
      revealedIndexes: [0],
      updatedAt: "2026-08-20T00:05:00.000Z",
    },
    followUps: [],
  });
  mocks.getSnapshot.mockResolvedValue({ snapshot: { traits: [], tensions: [] } });
  mocks.createInterpretationProvider.mockReturnValue({
    generateFollowUpWithProvenance: vi.fn(async () => ({
      result: { response: "A structured clarification. Treat this as reflection." },
      provenance: {
        providerId: "deterministic-fallback-v1",
        promptVersion: "deterministic-fallback-v3",
        schemaVersion: "follow-up-result-v1",
      },
    })),
  });
});

describe("follow-up runtime controls", () => {
  it("reports the published limit when a concurrent insert reaches it", async () => {
    mocks.createFollowUp.mockRejectedValue(new Error("FOLLOW_UP_LIMIT_REACHED"));
    const request = new Request(`https://starguidance.test/api/readings/${readingId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "followUp", question: "What changes this direction?" }),
    });

    const response = await POST(request, { params: Promise.resolve({ id: readingId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("3 follow-up questions");
    expect(mocks.createInterpretationProvider).toHaveBeenCalledWith({
      enabled: false,
      modelChain: ["openai/gpt-oss-120b"],
      promptBundleId: "reader-voice-v3",
    });
    expect(mocks.createFollowUp).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000911",
      readingId,
      expect.objectContaining({
        outputProvenance: {
          providerId: "deterministic-fallback-v1",
          promptVersion: "deterministic-fallback-v3",
          contentVersion: "starguidance-original-v1",
          safetyPolicyVersion: "question-safety-v2",
          schemaVersion: "follow-up-result-v1",
        },
      }),
      { limit: 3 },
    );
    expect(mocks.getReading.mock.results[0]?.value).toBeDefined();
  });
});
