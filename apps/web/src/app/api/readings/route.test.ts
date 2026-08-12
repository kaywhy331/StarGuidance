import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertCurrentPolicyConsents: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  getActiveProfile: vi.fn(),
  listReadings: vi.fn(),
  createLockedReading: vi.fn(),
  createLockedDraw: vi.fn(),
  createInterpretationProvider: vi.fn(),
  runInterpretationJobs: vi.fn(),
  recordAudit: vi.fn(),
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
  requireUser: mocks.requireUser,
  assertCurrentPolicyConsents: mocks.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
}));
vi.mock("@/lib/interpretation-worker", () => ({
  runInterpretationJobs: mocks.runInterpretationJobs,
}));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    repositories: {
      birthProfiles: { getActive: mocks.getActiveProfile },
      readingSessions: {
        list: mocks.listReadings,
        createLocked: mocks.createLockedReading,
      },
    },
  }),
  recordAudit: mocks.recordAudit,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: () => undefined,
}));
vi.mock("@/lib/runtime", () => ({ getRuntimeAdapter: vi.fn(() => "local") }));

import { POST } from "./route";

const user = { id: "84efdc32-5402-4d7d-97ef-94fb4143ac45", email: "reader@example.test" };

function request(question: string): Request {
  return new Request("https://staging.invalid/api/readings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify({ spreadId: "one-card", question }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.getActiveProfile.mockResolvedValue({
    snapshot: { id: "548e8158-2b54-4d28-a6bd-b6a4223f820b", traits: [], tensions: [] },
  });
});

describe("reading safety boundary", () => {
  it("interrupts direct suicidal ideation before creating or persisting a draw or job", async () => {
    const response = await POST(request("I want to die"));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      safety: { category: "selfHarmCrisis", interrupt: true },
    });
    expect(mocks.createLockedDraw).not.toHaveBeenCalled();
    expect(mocks.listReadings).not.toHaveBeenCalled();
    expect(mocks.createLockedReading).not.toHaveBeenCalled();
    expect(mocks.runInterpretationJobs).not.toHaveBeenCalled();
    expect(mocks.createInterpretationProvider).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });
});
