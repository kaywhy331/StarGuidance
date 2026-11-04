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
  // The distributed (Postgres-backed) path is covered by
  // packages/database/src/rate-limits.integration.test.ts against a real
  // database; this file exercises the local runtime adapter's in-memory
  // implementation, same as every other unit test in this workspace.
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
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

  it("accepts the configured production origin when Netlify exposes its internal branch host", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://starguidance.netlify.app");
    const productionRequest = request({
      host: "main--starguidance.netlify.app",
      "x-forwarded-host": "main--starguidance.netlify.app",
      origin: "https://starguidance.netlify.app",
    });

    expect(() => assertSameOrigin(productionRequest)).not.toThrow();
    expect(() =>
      assertSameOrigin(
        request({
          host: "main--starguidance.netlify.app",
          "x-forwarded-host": "main--starguidance.netlify.app",
          origin: "https://attacker.invalid",
        }),
      ),
    ).toThrow();
  });

  it("does not trust the configured production origin in a deploy preview", () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://starguidance.netlify.app");

    expect(() =>
      assertSameOrigin(request({ origin: "https://starguidance.netlify.app" })),
    ).toThrow();
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

  it("supports an explicitly configured edge-authenticated header off Netlify", () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "cf-connecting-ip");
    expect(
      clientRateLimitKey(
        request({
          "cf-connecting-ip": "2001:db8::1",
          "x-forwarded-for": "203.0.113.99",
        }),
      ),
    ).toBe("client:2001:db8::1");

    vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for");
    expect(clientRateLimitKey(request({ "x-forwarded-for": "203.0.113.99" }))).toBe(
      "client:unresolved",
    );
  });
});

describe("bounded rate limiting", () => {
  beforeEach(() => {
    // The outer beforeEach's SITE_NAME stub (for the Netlify-origin tests
    // above) would otherwise make isHostedNetlifyRuntime() true here, which
    // blocks the local runtime adapter these tests rely on.
    vi.stubEnv("SITE_NAME", "");
  });

  it("returns a consistent 429 description and Retry-After", async () => {
    await assertRateLimit("client:a", 1, 60_000);
    let failure;
    try {
      await assertRateLimit("client:a", 1, 60_000);
    } catch (error) {
      failure = requestSecurityFailure(error);
    }
    expect(failure).toEqual({
      status: 429,
      error: "Too many requests. Try again shortly.",
      headers: { "retry-after": "60" },
    });
  });

  it("distinguishes a limiter outage from an exhausted caller quota", () => {
    expect(requestSecurityFailure(new Error("RATE_LIMIT_UNAVAILABLE"))).toEqual({
      status: 503,
      error: "Service is temporarily unavailable. Try again shortly.",
      headers: { "retry-after": "60" },
    });
    expect(requestSecurityFailure(new Error("RATE_LIMITED"))).toEqual({
      status: 429,
      error: "Too many requests. Try again shortly.",
      headers: { "retry-after": "60" },
    });
  });

  it("caps attacker-created bucket keys", async () => {
    for (let index = 0; index < 10_100; index += 1)
      await assertRateLimit(`attacker:${index}`, 1, 60_000);
    expect(rateLimitBucketCountForTests()).toBeLessThanOrEqual(10_000);
  });
});
