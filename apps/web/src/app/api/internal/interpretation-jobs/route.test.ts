import { createHmac } from "node:crypto";

import { INTERPRETATION_WORKER_TOKEN_CONTEXT } from "@starguidance/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runInterpretationJobs: vi.fn(),
  runReportJobs: vi.fn(),
  getInterpretationQueueStats: vi.fn(),
  getReportQueueStats: vi.fn(),
  pruneExpiredSystemRows: vi.fn(),
}));

vi.mock("@/lib/interpretation-worker", () => ({
  runInterpretationJobs: mocks.runInterpretationJobs,
}));
vi.mock("@/lib/report-worker", () => ({ runReportJobs: mocks.runReportJobs }));

// This route only reaches @/lib/runtime for the raw pooled client, which the
// queue-stats query runs on directly (the connection-role path, migration
// 0008) — not meaningful against a real database in a unit test, so the
// client is an opaque placeholder no assertion here inspects.
vi.mock("@/lib/runtime", () => ({
  getSystemDatabaseClient: () => "synthetic-system-client",
}));

vi.mock("@starguidance/database", () => ({
  getInterpretationQueueStats: mocks.getInterpretationQueueStats,
  getReportQueueStats: mocks.getReportQueueStats,
  pruneExpiredSystemRows: mocks.pruneExpiredSystemRows,
}));

import { POST } from "./route";

// Deliberately not the placeholder-like strings shared-secret.test.ts already
// covers — a realistic strong secret, matching what INTERPRETATION_WORKER_SECRET
// is documented to require.
const STRONG_SECRET = "k8mZ3q7wLxJb4hR9nP2sT6vY0cD5fG1e";

function tokenFor(secret: string): string {
  return createHmac("sha256", secret)
    .update(INTERPRETATION_WORKER_TOKEN_CONTEXT)
    .digest("base64url");
}

function request(authorization?: string): Request {
  return new Request("https://synthetic.invalid/api/internal/interpretation-jobs", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("INTERPRETATION_WORKER_SECRET", STRONG_SECRET);
  mocks.runInterpretationJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0 });
  mocks.runReportJobs.mockResolvedValue({ claimed: 0, succeeded: 0, failed: 0 });
  mocks.getInterpretationQueueStats.mockResolvedValue({ depth: 0, oldestPendingAgeSeconds: null });
  mocks.getReportQueueStats.mockResolvedValue({ depth: 0, oldestPendingAgeSeconds: null });
  mocks.pruneExpiredSystemRows.mockResolvedValue({
    expiredRateLimitBuckets: 0,
    completedInterpretationJobs: 0,
    completedReportJobs: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/interpretation-jobs", () => {
  it("rejects a request with no authorization header", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.runInterpretationJobs).not.toHaveBeenCalled();
  });

  it("rejects the wrong bearer token", async () => {
    const response = await POST(
      request(`Bearer ${tokenFor("a-completely-different-secret-value!")}`),
    );
    expect(response.status).toBe(401);
    expect(mocks.runInterpretationJobs).not.toHaveBeenCalled();
  });

  it("rejects the raw secret sent as the bearer token instead of its HMAC", async () => {
    const response = await POST(request(`Bearer ${STRONG_SECRET}`));
    expect(response.status).toBe(401);
  });

  it("fails closed when the configured secret is weak, even with a correctly derived token", async () => {
    vi.stubEnv("INTERPRETATION_WORKER_SECRET", "short");
    const response = await POST(request(`Bearer ${tokenFor("short")}`));
    expect(response.status).toBe(401);
    expect(mocks.runInterpretationJobs).not.toHaveBeenCalled();
  });

  it("fails closed when the secret is unset", async () => {
    vi.stubEnv("INTERPRETATION_WORKER_SECRET", "");
    const response = await POST(request(`Bearer ${tokenFor(STRONG_SECRET)}`));
    expect(response.status).toBe(401);
  });

  it("drains a batch and reports the summary plus queue depth for the correct token", async () => {
    mocks.runInterpretationJobs.mockResolvedValue({ claimed: 3, succeeded: 2, failed: 1 });
    mocks.getInterpretationQueueStats.mockResolvedValue({ depth: 5, oldestPendingAgeSeconds: 42 });
    mocks.runReportJobs.mockResolvedValue({ claimed: 2, succeeded: 1, failed: 1 });
    mocks.getReportQueueStats.mockResolvedValue({ depth: 4, oldestPendingAgeSeconds: 21 });
    mocks.pruneExpiredSystemRows.mockResolvedValue({
      expiredRateLimitBuckets: 7,
      completedInterpretationJobs: 2,
      completedReportJobs: 1,
    });
    const response = await POST(request(`Bearer ${tokenFor(STRONG_SECRET)}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      claimed: 3,
      succeeded: 2,
      failed: 1,
      queueDepth: 5,
      oldestPendingAgeSeconds: 42,
      reports: { claimed: 2, succeeded: 1, failed: 1 },
      reportQueueDepth: 4,
      oldestPendingReportAgeSeconds: 21,
      pruned: {
        expiredRateLimitBuckets: 7,
        completedInterpretationJobs: 2,
        completedReportJobs: 1,
      },
    });
    expect(mocks.runInterpretationJobs).toHaveBeenCalledWith(1);
    expect(mocks.runReportJobs).toHaveBeenCalledWith(10);
    expect(mocks.pruneExpiredSystemRows).toHaveBeenCalledWith("synthetic-system-client");
  });

  it("does not prune when the drain is rejected as unauthorized", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.pruneExpiredSystemRows).not.toHaveBeenCalled();
  });

  it("reports a 500 without leaking details when claiming itself throws", async () => {
    mocks.runInterpretationJobs.mockRejectedValue(new Error("connection refused"));
    const response = await POST(request(`Bearer ${tokenFor(STRONG_SECRET)}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error" });
  });

  it("reports a 500 without leaking details when the queue-depth query itself throws", async () => {
    mocks.getInterpretationQueueStats.mockRejectedValue(new Error("connection refused"));
    const response = await POST(request(`Bearer ${tokenFor(STRONG_SECRET)}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error" });
  });
});
