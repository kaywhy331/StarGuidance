import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCurrentPolicyConsents: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  createInterpretationProvider: vi.fn(),
  createLockedDraw: vi.fn(),
  createLockedReading: vi.fn(),
  getActiveProfile: vi.fn(),
  getRuntimeConfiguration: vi.fn(),
  listReadings: vi.fn(),
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
  createLockedDraw: mocks.createLockedDraw,
}));
vi.mock("@/lib/auth", () => ({
  assertCurrentPolicyConsents: mocks.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
  requireUser: vi.fn(async () => ({
    id: "00000000-0000-4000-8000-000000000901",
    email: "reader@example.test",
  })),
}));
vi.mock("@/lib/interpretation-worker", () => ({ runInterpretationJobs: vi.fn() }));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: vi.fn(() => "encrypted-question"),
    decrypt: vi.fn(() => "A prior question"),
    repositories: {
      birthProfiles: { getActive: mocks.getActiveProfile },
      outputs: { save: mocks.saveOutput },
      readingSessions: {
        createLocked: mocks.createLockedReading,
        get: vi.fn(),
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
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: () => undefined,
}));
vi.mock("@/lib/runtime", () => ({ getRuntimeAdapter: () => "local" }));
vi.mock("@/lib/runtime-configuration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-configuration")>()),
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
}));

import { POST } from "./route";

const runtimeConfiguration = {
  content: {
    deckVersion: "starguidance-illustrated-v3",
    cardSetVersion: "starguidance-illustrated-v3",
    tarotContentVersion: "starguidance-original-v1",
    spreadCatalogVersion: "starguidance-spreads-v2",
    interpretationRulesVersion: "interpretation-rules-v1",
    enabledSpreadIds: ["one-card"],
  },
  prompts: {
    bundleId: "reader-voice-v3-grounded",
    safetyPolicyVersion: "question-safety-v2",
  },
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

function request(): Request {
  return new Request("https://starguidance.test/api/readings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "00000000-0000-4000-8000-000000000902",
    },
    body: JSON.stringify({ spreadId: "one-card", question: "What deserves my focus?" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeConfiguration.mockResolvedValue(structuredClone(runtimeConfiguration));
  mocks.getActiveProfile.mockResolvedValue({
    snapshot: {
      id: "00000000-0000-4000-8000-000000000903",
      traits: [],
      tensions: [],
    },
  });
  mocks.listReadings.mockResolvedValue([]);
  mocks.createLockedDraw.mockReturnValue({
    id: "00000000-0000-4000-8000-000000000904",
    deckVersion: "starguidance-illustrated-v3",
    spreadId: "one-card",
    spreadVersion: "one-card-v2",
    shuffleVersion: "fisher-yates-csprng-v1",
    lockedAt: "2026-08-20T00:00:00.000Z",
    assignments: [{ positionId: "focus", cardId: "major-00", orientation: "upright", order: 0 }],
  });
  mocks.createLockedReading.mockImplementation(async (reading) => reading);
  mocks.createInterpretationProvider.mockReturnValue({
    id: "synthetic",
    generate: vi.fn(),
    generateWithProvenance: vi.fn(async () => ({
      result: { title: "A reviewed result" },
      provenance: {
        providerId: "groq:openai/gpt-oss-120b",
        promptVersion: "reader-voice-v3-grounded",
        schemaVersion: "reading-output-v2",
      },
    })),
    generateFollowUp: vi.fn(),
    generateFollowUpWithProvenance: vi.fn(),
  });
  mocks.tryRecordProductEvent.mockResolvedValue(undefined);
});

describe("reading runtime controls", () => {
  it("removes a disabled spread before draw creation", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      ...structuredClone(runtimeConfiguration),
      content: { ...runtimeConfiguration.content, enabledSpreadIds: [] },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "That spread is currently unavailable." });
    expect(mocks.createLockedDraw).not.toHaveBeenCalled();
    expect(mocks.createLockedReading).not.toHaveBeenCalled();
  });

  it("uses the published prompt and filtered model chain for generation", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(mocks.createInterpretationProvider).toHaveBeenCalledWith({
      enabled: true,
      modelChain: ["openai/gpt-oss-120b"],
      promptBundleId: "reader-voice-v3-grounded",
    });
    expect(mocks.createLockedReading).toHaveBeenCalledOnce();
    expect(mocks.saveOutput).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000901",
      "00000000-0000-4000-8000-000000000904",
      { title: "A reviewed result" },
      {
        providerId: "groq:openai/gpt-oss-120b",
        promptVersion: "reader-voice-v3-grounded",
        contentVersion: "starguidance-original-v1",
        safetyPolicyVersion: "question-safety-v2",
        schemaVersion: "reading-output-v2",
      },
    );
  });

  it("enforces the published free-window allowance before drawing", async () => {
    mocks.getRuntimeConfiguration.mockResolvedValue({
      ...structuredClone(runtimeConfiguration),
      commerce: {
        ...runtimeConfiguration.commerce,
        readingAccessMode: "free-window",
        freeAllowance: 1,
      },
    });
    mocks.listReadings.mockResolvedValue([{ createdAt: new Date().toISOString() }]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect((await response.json()).entitlementDecision).toMatchObject({
      mode: "free-window",
      outcome: "limitReached",
      limit: 1,
    });
    expect(mocks.createLockedDraw).not.toHaveBeenCalled();
  });
});
