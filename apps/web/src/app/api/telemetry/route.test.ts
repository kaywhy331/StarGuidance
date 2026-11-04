import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  recordProductEvent: vi.fn(),
  requestSecurityFailure: vi.fn(),
}));

vi.mock("@/lib/product-telemetry", async (original) => {
  const actual = await original<typeof import("@/lib/product-telemetry")>();
  return { ...actual, recordProductEvent: mocks.recordProductEvent };
});
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  clientRateLimitKey: () => "opaque-client-class",
  requestSecurityFailure: mocks.requestSecurityFailure,
}));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("https://starguidance.test/api/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://starguidance.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestSecurityFailure.mockReturnValue(undefined);
});

describe("browser product-event boundary", () => {
  it("accepts an allowlisted event without adding request context", async () => {
    const event = {
      idempotencyKey: "browser:00000000-0000-4000-8000-000000000001",
      name: "landing_view",
      properties: { routeClass: "landing", referrerClass: "direct", deviceClass: "desktop" },
    };
    const response = await POST(request(event));

    expect(response.status).toBe(204);
    expect(mocks.recordProductEvent).toHaveBeenCalledWith(event);
  });

  it("rejects trusted-server events and arbitrary private properties", async () => {
    const serverOnly = await POST(
      request({
        idempotencyKey: "browser:00000000-0000-4000-8000-000000000002",
        name: "draw_locked",
        properties: { cardCount: 3 },
      }),
    );
    const privateContent = await POST(
      request({
        idempotencyKey: "browser:00000000-0000-4000-8000-000000000003",
        name: "result_viewed",
        properties: { question: "private question" },
      }),
    );

    expect(serverOnly.status).toBe(400);
    expect(privateContent.status).toBe(400);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });

  it("preserves the same-origin and rate-limit security boundary", async () => {
    mocks.assertSameOrigin.mockImplementationOnce(() => {
      throw new Error("INVALID_ORIGIN");
    });
    mocks.requestSecurityFailure.mockReturnValueOnce({
      error: "Request origin was rejected.",
      status: 403,
      headers: undefined,
    });

    const response = await POST(
      request({
        idempotencyKey: "browser:00000000-0000-4000-8000-000000000004",
        name: "landing_view",
        properties: {},
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.recordProductEvent).not.toHaveBeenCalled();
  });
});
