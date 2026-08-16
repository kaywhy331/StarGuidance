import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertCurrentPolicyConsents: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  getReading: vi.fn(),
  getSnapshot: vi.fn(),
  listFeedback: vi.fn(),
  createFollowUp: vi.fn(),
  createInterpretationProvider: vi.fn(),
  runInterpretationJobs: vi.fn(),
  recordAudit: vi.fn(),
  encrypt: vi.fn(),
  decrypt: vi.fn(),
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
  requireUser: mocks.requireUser,
  assertCurrentPolicyConsents: mocks.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
}));
vi.mock("@/lib/interpretation-worker", () => ({
  runInterpretationJobs: mocks.runInterpretationJobs,
}));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: mocks.encrypt,
    decrypt: mocks.decrypt,
    repositories: {
      readingSessions: { get: mocks.getReading },
      profileSnapshots: { get: mocks.getSnapshot },
      followUps: { create: mocks.createFollowUp },
      feedback: { list: mocks.listFeedback },
    },
  }),
  recordAudit: mocks.recordAudit,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: () => undefined,
}));
vi.mock("@/lib/runtime", () => ({
  getRuntimeAdapter: vi.fn(() => "local"),
  getSystemDatabaseClient: vi.fn(),
}));

import { GET, POST } from "./route";

const user = { id: "84efdc32-5402-4d7d-97ef-94fb4143ac45", email: "reader@example.test" };
const readingId = "c3c0b413-e890-4162-bf13-a54d47ab6c7e";

function request(question: string): Request {
  return new Request(`https://staging.invalid/api/readings/${readingId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "followUp", question }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.listFeedback.mockResolvedValue([]);
  mocks.getReading.mockResolvedValue({
    id: readingId,
    userId: user.id,
    profileSnapshotId: "548e8158-2b54-4d28-a6bd-b6a4223f820b",
    followUps: [{ id: "existing-follow-up" }],
    result: undefined,
  });
});

describe("reading ritual payload", () => {
  it("returns the owner's private question and contextual card description without caching", async () => {
    mocks.decrypt.mockReturnValue("What should I focus on next?");
    mocks.getReading.mockResolvedValue({
      id: readingId,
      userId: user.id,
      profileSnapshotId: "548e8158-2b54-4d28-a6bd-b6a4223f820b",
      spreadId: "one-card",
      encryptedQuestion: "encrypted-question",
      questionClassification: {
        version: "question-classification-v1",
        topic: "change",
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
      draw: {
        id: "locked-draw",
        deckVersion: "starguidance-illustrated-v2",
        spreadId: "one-card",
        spreadVersion: "one-card-v2",
        shuffleVersion: "fisher-yates-csprng-v1",
        lockedAt: "2026-08-15T00:00:00.000Z",
        assignments: [
          { positionId: "card-1", cardId: "major-00", orientation: "upright", order: 0 },
        ],
      },
      result: undefined,
      outputProvenance: undefined,
      generationStatus: "pending",
      ritualProgress: undefined,
      expiresAt: "2099-08-15T00:00:00.000Z",
      safetyClassification: undefined,
      followUps: [],
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    const response = await GET(new Request(`https://staging.invalid/api/readings/${readingId}`), {
      params: Promise.resolve({ id: readingId }),
    });
    const payload = (await response.json()) as {
      reading: {
        question: string;
        cards: { positionDescription: string; themes: string[] }[];
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(payload.reading.question).toBe("What should I focus on next?");
    expect(payload.reading.cards[0]?.positionDescription).toBeTruthy();
    expect(payload.reading.cards[0]?.themes.length).toBeGreaterThan(0);
    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-question", "reading-question");
  });
});

describe("follow-up safety boundary", () => {
  it("interrupts direct suicidal ideation before auth, reading access, limits, or persistence", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));
    mocks.getReading.mockResolvedValue(undefined);

    const response = await POST(request("I want to die"), {
      params: Promise.resolve({ id: readingId }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      safety: { category: "selfHarmCrisis", interrupt: true },
    });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.getReading).not.toHaveBeenCalled();
    expect(mocks.assertCurrentPolicyConsents).not.toHaveBeenCalled();
    expect(mocks.assertRateLimit).not.toHaveBeenCalled();
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.createInterpretationProvider).not.toHaveBeenCalled();
    expect(mocks.runInterpretationJobs).not.toHaveBeenCalled();
    expect(mocks.createFollowUp).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("does not let an ordinary follow-up bypass authentication", async () => {
    mocks.requireUser.mockRejectedValue(new Error("UNAUTHENTICATED"));

    const response = await POST(request("What else should I consider?"), {
      params: Promise.resolve({ id: readingId }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required." });
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.getReading).not.toHaveBeenCalled();
    expect(mocks.createInterpretationProvider).not.toHaveBeenCalled();
    expect(mocks.createFollowUp).not.toHaveBeenCalled();
  });
});
