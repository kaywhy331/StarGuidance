import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCurrentPolicyConsents: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  calculateProfile: vi.fn(),
  getRuntimeConfiguration: vi.fn(),
  requireUser: vi.fn(),
  tryRecordProductEvent: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  assertCurrentPolicyConsents: mocks.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
  requireUser: mocks.requireUser,
}));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: vi.fn(),
  recordAudit: vi.fn(),
  saveProfileVersion: vi.fn(),
}));
vi.mock("@/lib/product-telemetry", () => ({
  tryRecordProductEvent: mocks.tryRecordProductEvent,
}));
vi.mock("@/lib/profile-engine", () => ({ calculateProfile: mocks.calculateProfile }));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: () => undefined,
}));
vi.mock("@/lib/runtime-configuration", () => ({
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
  profileReportsEnabled: vi.fn(),
}));

import { POLICY_VERSIONS } from "@/lib/policies";

import { POST } from "./route";

function request(overrides: Record<string, unknown> = {}): Request {
  return new Request("https://starguidance.test/api/profile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fullBirthName: "Private Unicode Name Ω",
      birthDate: "1990-03-14",
      consentVersion: POLICY_VERSIONS.profilePersonalization,
      ...overrides,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000801",
    consentRecords: [],
  });
  mocks.getRuntimeConfiguration.mockResolvedValue({
    features: { enabledProfileSystems: ["numerology", "dreamspell"] },
  });
  mocks.tryRecordProductEvent.mockResolvedValue(undefined);
});

describe("profile calculation failure boundary", () => {
  it("records a content-free timeout signal and preserves the prior profile", async () => {
    mocks.calculateProfile.mockRejectedValue(new Error("PROFILE_ENGINE_TIMEOUT"));

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ reason: "PROFILE_ENGINE_TIMEOUT" });
    expect(mocks.tryRecordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "profile_failed",
        properties: { errorClass: "provider_timeout", statusClass: "failed" },
      }),
    );
    expect(JSON.stringify(mocks.tryRecordProductEvent.mock.calls)).not.toContain(
      "Private Unicode Name",
    );
  });

  it("classifies rejected birth details without persisting partial output", async () => {
    mocks.calculateProfile.mockRejectedValue(new Error("PROFILE_CALCULATION_REJECTED"));

    const response = await POST(request());

    expect(response.status).toBe(422);
    expect(mocks.tryRecordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "profile_failed",
        properties: { errorClass: "validation", statusClass: "failed" },
      }),
    );
  });

  it("does not treat local form validation as an engine incident", async () => {
    const response = await POST(request({ birthDate: "not-a-date" }));

    expect(response.status).toBe(422);
    expect(mocks.calculateProfile).not.toHaveBeenCalled();
    expect(mocks.tryRecordProductEvent).not.toHaveBeenCalled();
  });
});
