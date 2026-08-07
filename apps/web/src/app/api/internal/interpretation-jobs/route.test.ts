import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runInterpretationJobs: vi.fn(),
}));

vi.mock("@/lib/interpretation-worker", () => ({
  runInterpretationJobs: mocks.runInterpretationJobs,
}));

import { POST } from "./route";

// Deliberately not the placeholder-like strings shared-secret.test.ts already
// covers — a realistic strong secret, matching what INTERPRETATION_WORKER_SECRET
// is documented to require.
const STRONG_SECRET = "k8mZ3q7wLxJb4hR9nP2sT6vY0cD5fG1e";
const TOKEN_CONTEXT = "starguidance-interpretation-worker-v1";

function tokenFor(secret: string): string {
  return createHmac("sha256", secret).update(TOKEN_CONTEXT).digest("base64url");
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

  it("drains a batch and reports the summary for the correct token", async () => {
    mocks.runInterpretationJobs.mockResolvedValue({ claimed: 3, succeeded: 2, failed: 1 });
    const response = await POST(request(`Bearer ${tokenFor(STRONG_SECRET)}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", claimed: 3, succeeded: 2, failed: 1 });
    expect(mocks.runInterpretationJobs).toHaveBeenCalledWith(10);
  });

  it("reports a 500 without leaking details when claiming itself throws", async () => {
    mocks.runInterpretationJobs.mockRejectedValue(new Error("connection refused"));
    const response = await POST(request(`Bearer ${tokenFor(STRONG_SECRET)}`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error" });
  });
});
