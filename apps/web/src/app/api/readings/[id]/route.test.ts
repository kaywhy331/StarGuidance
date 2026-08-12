import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertCurrentPolicyConsents: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  getReading: vi.fn(),
  getSnapshot: vi.fn(),
  createFollowUp: vi.fn(),
  createInterpretationProvider: vi.fn(),
  runInterpretationJobs: vi.fn(),
  recordAudit: vi.fn(),
  encrypt: vi.fn(),
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
    decrypt: vi.fn(),
    repositories: {
      readingSessions: { get: mocks.getReading },
      profileSnapshots: { get: mocks.getSnapshot },
      followUps: { create: mocks.createFollowUp },
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

import { POST } from "./route";

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
  mocks.getReading.mockResolvedValue({
    id: readingId,
    userId: user.id,
    profileSnapshotId: "548e8158-2b54-4d28-a6bd-b6a4223f820b",
    followUps: [{ id: "existing-follow-up" }],
    result: undefined,
  });
});

describe("follow-up safety boundary", () => {
  it("interrupts direct suicidal ideation before limits, provider work, or persistence", async () => {
    const response = await POST(request("I want to die"), {
      params: Promise.resolve({ id: readingId }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      safety: { category: "selfHarmCrisis", interrupt: true },
    });
    expect(mocks.getSnapshot).not.toHaveBeenCalled();
    expect(mocks.createInterpretationProvider).not.toHaveBeenCalled();
    expect(mocks.runInterpretationJobs).not.toHaveBeenCalled();
    expect(mocks.createFollowUp).not.toHaveBeenCalled();
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
