import { INTERPRETATION_WORKER_TOKEN_CONTEXT } from "@starguidance/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import handler, {
  config,
  evaluateOperationalAlerts,
  TOKEN_CONTEXT,
} from "../functions/process-interpretation-jobs.mts";

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

  it("classifies only fixed aggregate operational signals above threshold", () => {
    vi.stubEnv("OPERATIONAL_LIVE_AI_VOLUME_ALERT_THRESHOLD", "10");
    expect(
      evaluateOperationalAlerts({
        queueDepth: 20,
        oldestPendingAgeSeconds: 181,
        failed: 1,
        reports: { failed: 0 },
        signals: {
          authFailures5m: 21,
          profileFailures5m: 5,
          generationFailures5m: 6,
          paymentFailures15m: 3,
          slowGenerations5m: 4,
          liveGenerations60m: 11,
          ignoredPrivateField: "never forwarded",
        },
      }).map(({ alertClass }) => alertClass),
    ).toEqual([
      "interpretation_queue_age",
      "interpretation_job_failure",
      "auth_failure_rate",
      "generation_failure_rate",
      "payment_failure_rate",
      "generation_latency",
      "live_ai_volume",
    ]);
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

  it("delivers one content-free aggregate payload to the configured HTTPS receiver", async () => {
    configureEnv();
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("OPERATIONAL_ALERT_WEBHOOK_URL", "https://alerts.synthetic.invalid/hooks/opaque");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            queueDepth: 0,
            reportQueueDepth: 0,
            signals: { profileFailures5m: 6 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await handler();

    expect(response.status).toBe(202);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("profile failures in five minutes 6"),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [target, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(target.toString()).toBe("https://alerts.synthetic.invalid/hooks/opaque");
    expect(JSON.parse(String(init.body))).toEqual({
      event: "starguidance_operational_alert",
      version: "operational-alert-v1",
      environment: "production",
      alerts: [
        {
          alertClass: "profile_failure_rate",
          severity: "critical",
          observed: 6,
          threshold: 5,
        },
      ],
    });
    expect(String(init.body)).not.toMatch(/user|email|birth|question|card|report prose/i);
  });

  it("does not send alerts to a non-HTTPS receiver", async () => {
    configureEnv();
    vi.stubEnv("OPERATIONAL_ALERT_WEBHOOK_URL", "http://127.0.0.1/private");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ queueDepth: 21, reportQueueDepth: 0 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    expect((await handler()).status).toBe(202);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fail the trigger when the response body cannot be parsed as JSON", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));

    const response = await handler();

    expect(response.status).toBe(202);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not parse trigger response body"),
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

  it("never logs an arbitrary network exception or configured callback URL", async () => {
    configureEnv();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new Error("request to https://synthetic.invalid/private?token=must-not-log failed"),
        ),
    );

    expect((await handler()).status).toBe(502);
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).toContain("trigger request failed");
    expect(logged).not.toContain("must-not-log");
    expect(logged).not.toContain("synthetic.invalid");
  });
});
