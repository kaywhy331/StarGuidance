import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertRateLimit,
  assertSameOrigin,
  clientRateLimitKey,
  rateLimitBucketCountForTests,
  requestSecurityFailure,
  resetRequestSecurityForTests,
} from "./request-security";

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://internal-deploy--starguidance.netlify.app/api/test", {
    headers: {
      host: "preview--starguidance.netlify.app",
      "x-forwarded-host": "preview--starguidance.netlify.app",
      "x-forwarded-proto": "https",
      ...headers,
    },
  });
}

beforeEach(() => {
  resetRequestSecurityForTests();
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("SITE_NAME", "starguidance");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-05T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("request metadata security", () => {
  it("requires a matching Origin for state-changing routes", () => {
    expect(() =>
      assertSameOrigin(request({ origin: "https://preview--starguidance.netlify.app" })),
    ).not.toThrow();
    for (const origin of [undefined, "null", "https://attacker.invalid"]) {
      const headers = origin ? { origin } : {};
      expect(() => assertSameOrigin(request(headers))).toThrow();
    }
  });

  it("uses only the provider-authenticated address and ignores raw forwarded spoofing", () => {
    expect(
      clientRateLimitKey(
        request({
          "x-forwarded-for": "203.0.113.99, 10.0.0.1",
          "x-nf-client-connection-ip": "::ffff:192.0.2.44",
        }),
      ),
    ).toBe("client:192.0.2.44");
    expect(clientRateLimitKey(request({ "x-forwarded-for": "203.0.113.99" }))).toBe(
      "client:unresolved",
    );
  });
});

describe("bounded rate limiting", () => {
  it("returns a consistent 429 description and Retry-After", () => {
    assertRateLimit("client:a", 1, 60_000);
    let failure;
    try {
      assertRateLimit("client:a", 1, 60_000);
    } catch (error) {
      failure = requestSecurityFailure(error);
    }
    expect(failure).toEqual({
      status: 429,
      error: "Too many requests. Try again shortly.",
      headers: { "retry-after": "60" },
    });
  });

  it("caps attacker-created bucket keys", () => {
    for (let index = 0; index < 10_100; index += 1) assertRateLimit(`attacker:${index}`, 1, 60_000);
    expect(rateLimitBucketCountForTests()).toBeLessThanOrEqual(10_000);
  });
});
