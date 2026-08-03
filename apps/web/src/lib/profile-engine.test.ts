import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateProfile } from "./profile-engine";

/**
 * A response that never arrived, one that arrived too late, and one that
 * arrived in an unexpected shape are three different faults with three
 * different remedies. Collapsing them into "unavailable" sends an operator to
 * check uptime when the payload changed, which is exactly what happened during
 * staging verification.
 */
const INPUT = { fullBirthName: "Ada Synthetic", birthDate: "1990-01-15" } as never;

beforeEach(() => {
  vi.stubEnv("PROFILE_ENGINE_URL", "https://engine.invalid");
  vi.stubEnv("PROFILE_ENGINE_SHARED_SECRET", "synthetic-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("profile engine failure modes", () => {
  it("reports a rejected calculation distinctly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 422 })));
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_CALCULATION_REJECTED");
  });

  it("reports its own deadline expiring as a timeout, not an absence", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_TIMEOUT");
  });

  it("reports a response that does not match the contract distinctly", async () => {
    // Reaches the service, returns 200, and omits fields the application needs.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ completeness: "core", numerology: {} }), { status: 200 }),
        ),
    );
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_CONTRACT_MISMATCH");
  });

  it("still reports an unreachable service as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("connection refused")));
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_UNAVAILABLE");
  });

  it("reports a server error from the engine as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_UNAVAILABLE");
  });
});
