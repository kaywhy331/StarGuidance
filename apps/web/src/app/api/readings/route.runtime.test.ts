import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createInterpretationProvider: vi.fn(),
  createLockedReading: vi.fn(),
  finalizeCommittedDraw: vi.fn(),
  getActiveProfile: vi.fn(),
  getReading: vi.fn(),
  getRuntimeConfiguration: vi.fn(),
  issueDrawCeremony: vi.fn(),
  listReadings: vi.fn(),
  readDrawCeremony: vi.fn(),
  recordAudit: vi.fn(),
  saveOutput: vi.fn(),
  setGenerationStatus: vi.fn(),
  tryRecordProductEvent: vi.fn(),
}));

vi.mock("@starguidance/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@starguidance/ai")>()),
  createInterpretationProvider: mocks.createInterpretationProvider,
}));
vi.mock("@starguidance/tarot-domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@starguidance/tarot-domain")>()),
  finalizeCommittedDraw: mocks.finalizeCommittedDraw,
}));
vi.mock("@/lib/auth", () => ({
  assertCurrentPolicyConsents: vi.fn(),
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
  requireUser: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000901",
    email: "reader@example.test",
  })),
}));
vi.mock("@/lib/draw-ceremony", () => ({
  issueDrawCeremony: mocks.issueDrawCeremony,
  publicDrawCeremony: vi.fn(),
  readDrawCeremony: mocks.readDrawCeremony,
}));
vi.mock("@/lib/interpretation-worker", () => ({ runInterpretationJobs: vi.fn() }));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: vi.fn((value: string, purpose: string) => `encrypted:${purpose}:${value}`),
    decrypt: vi.fn(() => "A prior question"),
    repositories: {
      birthProfiles: { getActive: mocks.getActiveProfile },
      outputs: { save: mocks.saveOutput },
      profileSnapshots: { get: vi.fn(async () => undefined) },
      readingSessions: {
        createLocked: mocks.createLockedReading,
        get: mocks.getReading,
        list: mocks.listReadings,
        setGenerationStatus: mocks.setGenerationStatus,
      },
    },
  }),
  recordAudit: mocks.recordAudit,
}));
vi.mock("@/lib/product-telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/product-telemetry")>()),
  tryRecordProductEvent: mocks.tryRecordProductEvent,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  requestSecurityFailure: () => undefined,
}));
vi.mock("@/lib/runtime", () => ({ getRuntimeAdapter: () => "local" }));
vi.mock("@/lib/runtime-configuration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-configuration")>()),
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
}));

import { POST } from "./route";

const userId = "00000000-0000-4000-8000-000000000901";
const readingId = "00000000-0000-4000-8000-000000000904";
const idempotencyKey = "00000000-0000-4000-8000-000000000902";
const configuration = {
  version: "reading-configuration-v1" as const,
  reversalMode: "reversals_enabled" as const,
  personalizationMode: "pure_tarot" as const,
  positions: [
    {
      id: "card-1",
      displayName: "Focus",
      interpretiveFunction: "the concentrated center of the reading",
      description: "The central theme, what to notice, and practical guidance.",
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
const entitlementDecision = {
  version: "reading-entitlement-v1" as const,
  mode: "unlimited" as const,
  outcome: "granted" as const,
  entitlementClass: "standard" as const,
  used: 0,
  limit: null,
  remaining: null,
  windowStartsAt: null,
  windowEndsAt: null,
};
const privateCeremony = {
  version: "private-draw-ceremony-v1",
  readingId,
  userId,
  idempotencyKey,
  deckVersion: "starguidance-illustrated-v3",
  profileSnapshotId: "00000000-0000-4000-8000-000000000903",
  readingLens: { version: "question-trait-lens-v2", traitIndexes: [], tensionIndexes: [] },
  question: "What deserves my focus?",
  questionClassification: {
    version: "question-classification-v1" as const,
    topic: "general" as const,
    horizon: "open" as const,
    intent: "clarity" as const,
    generalReading: false,
  },
  entitlementDecision,
  safetyClassification: "ordinary",
  continueAsReflection: false,
  spread: { id: "one-card", version: "one-card-v3" },
  configuration,
  serverSeed: Buffer.alloc(32, 11).toString("base64url"),
  serverSeedCommitment: Buffer.alloc(32, 12).toString("base64url"),
};
const lockedDraw = {
  id: readingId,
  deckVersion: "starguidance-illustrated-v3",
  spreadId: "one-card",
  spreadVersion: "one-card-v3",
  shuffleVersion: "fisher-yates-committed-v2",
  assignments: [
    { positionId: "card-1", cardId: "major-00", orientation: "upright" as const, order: 0 },
  ],
  proof: {
    entropyVersion: "hmac-sha256-domain-stream-v1",
    serverSeedCommitment: privateCeremony.serverSeedCommitment,
    clientNonceHash: Buffer.alloc(32, 13).toString("base64url"),
    cutIndex: 20,
    reversalMode: "reversals_enabled" as const,
  },
  lockedAt: "2026-08-20T00:00:00.000Z",
};
const result = {
  schemaVersion: "reading-result-v3" as const,
  directAnswer: "A reviewed result.",
  overallPattern: "One card holds the focus.",
  cards: [
    {
      positionId: "card-1",
      positionLabel: "Focus",
      cardId: "major-00",
      orientation: "upright" as const,
      coreMeaning: "A beginning.",
      positionInterpretation: "A beginning in Focus.",
      relationshipNotes: [],
      supportingEvidence: ["The Fool upright in Focus."],
    },
  ],
  synthesis: "One beginning becomes a grounded next step.",
  likelyTrajectory: null,
  alternatePath: null,
  timing: null,
  userAgency: "Choose one reversible action.",
  reflectionPrompt: "What can begin now?",
  uncertaintyNote: "This does not guarantee an outcome.",
  personalizationLens: null,
  safetyFlags: [],
};
const runtimeConfiguration = {
  content: {
    deckVersion: "starguidance-illustrated-v3",
    cardSetVersion: "starguidance-illustrated-v3",
    tarotContentVersion: "starguidance-original-v1",
    spreadCatalogVersion: "starguidance-spreads-v3",
    interpretationRulesVersion: "interpretation-rules-v1",
    enabledSpreadIds: ["one-card"],
  },
  prompts: { bundleId: "reader-voice-v5-grounded", safetyPolicyVersion: "question-safety-v2" },
  commerce: {
    readingAccessMode: "unlimited",
    freeAllowance: 3,
    allowanceWindowHours: 24,
    followUpLimit: 1,
    rereadCooldownMinutes: 0,
    reportProductId: "profile-report-v1",
    currency: "USD",
    priceMinor: 2900,
  },
  features: {
    profileReportsEnabled: false,
    animationsEnabled: true,
    animationVariant: "immersive-v1",
    enabledProfileSystems: ["numerology", "dreamspell"],
  },
  models: {
    liveAiEnabled: true,
    primaryModel: "openai/gpt-oss-120b",
    fallbackModels: ["openai/gpt-oss-20b"],
    disabledModels: ["openai/gpt-oss-20b"],
  },
  versions: { content: 1, prompts: 2, commerce: 3, features: 4, models: 5 },
} as const;

function request(body: Record<string, unknown>): Request {
  return new Request("https://starguidance.test/api/readings", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeConfiguration.mockResolvedValue(structuredClone(runtimeConfiguration));
  mocks.getActiveProfile.mockResolvedValue({
    snapshot: {
      id: privateCeremony.profileSnapshotId,
      traits: [],
      tensions: [],
    },
  });
  mocks.listReadings.mockResolvedValue([]);
  mocks.getReading.mockResolvedValue(undefined);
  mocks.issueDrawCeremony.mockReturnValue({
    ceremony: { sessionId: readingId, token: "x".repeat(40) },
  });
  mocks.readDrawCeremony.mockReturnValue(privateCeremony);
  mocks.finalizeCommittedDraw.mockReturnValue(lockedDraw);
  mocks.createLockedReading.mockImplementation(async (reading) => reading);
  mocks.createInterpretationProvider.mockReturnValue({
    generateWithProvenance: vi.fn(async () => ({
      result,
      provenance: {
        providerId: "groq:openai/gpt-oss-120b",
        promptVersion: "reader-voice-v5-grounded",
        schemaVersion: "reading-result-v3",
      },
    })),
  });
  mocks.tryRecordProductEvent.mockResolvedValue(undefined);
});

describe("reading runtime controls across prepare and finalization", () => {
  it("rejects a disabled spread before a ceremony or draw exists", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      ...structuredClone(runtimeConfiguration),
      content: { ...runtimeConfiguration.content, enabledSpreadIds: [] },
    });
    const response = await POST(
      request({
        action: "prepare",
        spreadId: "one-card",
        question: "What deserves my focus?",
        questionConfirmed: true,
        reversalMode: "reversals_enabled",
        personalizationMode: "pure_tarot",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That spread is currently unavailable." });
    expect(mocks.issueDrawCeremony).not.toHaveBeenCalled();
    expect(mocks.finalizeCommittedDraw).not.toHaveBeenCalled();
  });

  it("uses the governed prompt/model chain only after committed draw finalization", async () => {
    const response = await POST(
      request({
        action: "finalize",
        ceremonyToken: "x".repeat(40),
        clientNonce: Buffer.alloc(32, 17).toString("base64url"),
        cutIndex: 20,
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.finalizeCommittedDraw).toHaveBeenCalledWith(
      expect.objectContaining({ cutIndex: 20, sessionId: readingId }),
    );
    expect(mocks.createLockedReading).toHaveBeenCalledOnce();
    expect(mocks.createInterpretationProvider).toHaveBeenCalledWith({
      enabled: true,
      modelChain: ["openai/gpt-oss-120b"],
      promptBundleId: "reader-voice-v5-grounded",
    });
    expect(mocks.saveOutput).toHaveBeenCalledWith(
      userId,
      readingId,
      result,
      expect.objectContaining({ schemaVersion: "reading-result-v3" }),
    );
  });

  it("enforces the governed allowance before creating a ceremony", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      ...structuredClone(runtimeConfiguration),
      commerce: {
        ...runtimeConfiguration.commerce,
        readingAccessMode: "free-window",
        freeAllowance: 1,
      },
    });
    mocks.listReadings.mockResolvedValue([{ createdAt: new Date().toISOString() }]);
    const response = await POST(
      request({
        action: "prepare",
        spreadId: "one-card",
        question: "What deserves my focus?",
        questionConfirmed: true,
        reversalMode: "reversals_enabled",
        personalizationMode: "pure_tarot",
      }),
    );
    expect(response.status).toBe(429);
    expect((await response.json()).entitlementDecision).toMatchObject({
      mode: "free-window",
      outcome: "limitReached",
      limit: 1,
    });
    expect(mocks.issueDrawCeremony).not.toHaveBeenCalled();
  });
});
