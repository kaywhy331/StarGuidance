import { INTERPRETATION_WORKER_TOKEN_CONTEXT } from "@starguidance/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import handler, { config, TOKEN_CONTEXT } from "../functions/process-interpretation-jobs.mts";

const STRONG_SECRET = "synthetic-interpretation-worker-shared-secret";

function configureEnv() {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://synthetic.invalid");
  vi.stubEnv("INTERPRETATION_WORKER_SECRET", STRONG_SECRET);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// This function is deliberately dependency-free at deploy time (see the
// sibling file's own top comment), so it keeps its own literal HMAC context
// string rather than importing @starguidance/contracts at runtime. This test
// is the only thing standing between that literal and silently drifting away
// from the copy the Next.js drain route actually checks against — if it
// does, every scheduled trigger starts getting rejected as unauthorized.
describe("process-interpretation-jobs", () => {
  it("keeps its own TOKEN_CONTEXT literal equal to the shared contracts constant", () => {
    expect(TOKEN_CONTEXT).toBe(INTERPRETATION_WORKER_TOKEN_CONTEXT);
  });

  it("runs on a one-minute schedule", () => {
    expect(config.schedule).toBe("*/1 * * * *");
  });

  it("alerts when the interpretation queue depth exceeds the threshold", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ queueDepth: 21, reportQueueDepth: 0 }), { status: 200 }),
        ),
    );

    const response = await handler();

    expect(response.status).toBe(202);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("interpretation queue depth 21 exceeds alert threshold"),
    );
  });

  it("alerts when the report queue depth exceeds the threshold", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ queueDepth: 0, reportQueueDepth: 21 }), { status: 200 }),
        ),
    );

    const response = await handler();

    expect(response.status).toBe(202);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("report queue depth 21 exceeds alert threshold"),
    );
  });

  it("stays quiet when both queue depths are at or under the threshold", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ queueDepth: 20, reportQueueDepth: 20 }), { status: 200 }),
        ),
    );

    const response = await handler();

    expect(response.status).toBe(202);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("does not fail the trigger when the response body cannot be parsed as JSON", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    const response = await handler();

    expect(response.status).toBe(202);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not parse trigger response body"),
      expect.anything(),
    );
  });

  it("still reports a gateway failure when the trigger responds non-2xx", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));

    const response = await handler();

    expect(response.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("trigger responded 500"));
  });
});
