import { afterEach, describe, expect, it, vi } from "vitest";

import { emitBrowserProductEventOnce } from "./product-telemetry-client";

afterEach(() => vi.unstubAllGlobals());

describe("browser product telemetry", () => {
  it("emits a milestone once per tab without transmitting its opaque receipt scope", async () => {
    const receipts = new Map<string, string>();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => receipts.get(key) ?? null,
        setItem: (key: string, value: string) => receipts.set(key, value),
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const scope = "reading:00000000-0000-4000-8000-000000000101";
    emitBrowserProductEventOnce("result_viewed", scope, {
      routeClass: "result",
      cardCount: 3,
      statusClass: "ready",
    });
    emitBrowserProductEventOnce("result_viewed", scope, {
      routeClass: "result",
      cardCount: 3,
      statusClass: "ready",
    });
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body);
    expect(body).toContain('"name":"result_viewed"');
    expect(body).toContain('"cardCount":3');
    expect(body).not.toContain(scope);
  });

  it("keeps measurement best-effort when session storage is unavailable", async () => {
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: () => {
          throw new Error("storage unavailable");
        },
        setItem: () => undefined,
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(() =>
      emitBrowserProductEventOnce("report_viewed", "report:opaque", {
        routeClass: "report",
        statusClass: "ready",
      }),
    ).not.toThrow();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
