import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_LOST_MESSAGE,
  SERVER_UNAVAILABLE_MESSAGE,
  requestJson,
  sendJson,
} from "./client-request";

afterEach(() => vi.unstubAllGlobals());

describe("requestJson", () => {
  it("returns parsed data for a 2xx JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ a: 1 }), { status: 200 })),
    );
    await expect(requestJson("/x")).resolves.toEqual({ ok: true, status: 200, data: { a: 1 } });
  });

  it("surfaces the server error string on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Nope." }), { status: 409 })),
    );
    const result = await requestJson("/x");
    expect(result).toMatchObject({ ok: false, status: 409, error: "Nope." });
  });

  it("never throws on an HTML error page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>502</html>", { status: 502 })),
    );
    await expect(requestJson("/x")).resolves.toMatchObject({
      ok: false,
      status: 502,
      error: SERVER_UNAVAILABLE_MESSAGE,
    });
  });

  it("maps a network failure to status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await expect(sendJson("/x", "POST", {})).resolves.toMatchObject({
      ok: false,
      status: 0,
      error: CONNECTION_LOST_MESSAGE,
    });
  });
});
