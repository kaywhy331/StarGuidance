import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  getReading: vi.fn(),
  createFeedback: vi.fn(),
  encrypt: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: mocks.encrypt,
    repositories: {
      readingSessions: { get: mocks.getReading },
      feedback: { create: mocks.createFeedback },
    },
  }),
  recordAudit: mocks.recordAudit,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: () => undefined,
}));

import { POST } from "./route";

const user = { id: "84efdc32-5402-4d7d-97ef-94fb4143ac45", email: "reader@example.test" };
const readingId = "c3c0b413-e890-4162-bf13-a54d47ab6c7e";

function request(body: unknown) {
  return new Request(`https://staging.invalid/api/readings/${readingId}/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.getReading.mockResolvedValue({ id: readingId });
  mocks.encrypt.mockReturnValue("encrypted-comment");
  mocks.createFeedback.mockResolvedValue({
    id: "feedback-1",
    userId: user.id,
    readingId,
    resonance: 4,
    helpfulness: 5,
    encryptedComment: "encrypted-comment",
    createdAt: "2026-08-10T12:00:00.000Z",
  });
});

describe("reading feedback", () => {
  it("stores the optional comment encrypted and returns no plaintext", async () => {
    const response = await POST(request({ resonance: 4, helpfulness: 5, comment: "It helped." }), {
      params: Promise.resolve({ id: readingId }),
    });

    expect(response.status).toBe(201);
    expect(mocks.encrypt).toHaveBeenCalledWith("It helped.", "feedback-comment");
    expect(mocks.createFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ encryptedComment: "encrypted-comment", readingId }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("It helped");
  });

  it("rejects empty or out-of-range feedback", async () => {
    const empty = await POST(request({}), { params: Promise.resolve({ id: readingId }) });
    const invalid = await POST(request({ helpfulness: 6 }), {
      params: Promise.resolve({ id: readingId }),
    });
    expect(empty.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
  });

  it("does not reveal whether another user's reading exists", async () => {
    mocks.getReading.mockResolvedValue(undefined);
    const response = await POST(request({ helpfulness: 4 }), {
      params: Promise.resolve({ id: readingId }),
    });
    expect(response.status).toBe(404);
    expect(mocks.createFeedback).not.toHaveBeenCalled();
  });
});
