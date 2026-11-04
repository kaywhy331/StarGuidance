import { describe, expect, it } from "vitest";

import nextConfig from "../../next.config";

describe("application security headers", () => {
  it("denies framing and narrows browser capabilities on every route", async () => {
    const routes = await nextConfig.headers?.();
    expect(routes).toBeDefined();
    const headers = new Map(
      (routes ?? []).flatMap((route) =>
        route.headers.map(({ key, value }) => [key, value] as const),
      ),
    );

    expect(headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("object-src 'none'");
    expect(headers.get("Content-Security-Policy")).toContain("media-src 'self' blob:");
    expect(headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(headers.get("Permissions-Policy")).toContain("camera=()");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("prevents intermediary or browser storage of authenticated API payloads", async () => {
    const routes = await nextConfig.headers?.();
    const api = (routes ?? []).find(({ source }) => source === "/api/:path*");

    expect(api?.headers).toContainEqual({
      key: "Cache-Control",
      value: "private, no-store, max-age=0",
    });
  });
});
