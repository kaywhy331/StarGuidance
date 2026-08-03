import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { calculateProfile, profileEngineBaseUrl } from "./profile-engine";

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

  it("does not retry a rejected input", async () => {
    // Repeating it would only make the person wait longer for the same answer.
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 422 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_CALCULATION_REJECTED");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a misconfigured address or a changed contract", async () => {
    vi.stubEnv("PROFILE_ENGINE_URL", "https://engine.example/health");
    const misconfigured = vi.fn();
    vi.stubGlobal("fetch", misconfigured);
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_MISCONFIGURED");
    expect(misconfigured).not.toHaveBeenCalled();

    vi.stubEnv("PROFILE_ENGINE_URL", "https://engine.example");
    const drifted = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ completeness: "core" }), { status: 200 }));
    vi.stubGlobal("fetch", drifted);
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_CONTRACT_MISMATCH");
    expect(drifted).toHaveBeenCalledTimes(1);
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

describe("profile engine address resolution", () => {
  it("builds the same request whether or not the variable ends in a slash", async () => {
    // A trailing slash produced `//v1/profile/compute`, which the service
    // answers with 404 while the health check — which normalised the same value
    // — kept reporting the dependency healthy. Every calculation failed and
    // nothing said why.
    for (const configured of [
      "https://engine.example",
      "https://engine.example/",
      "https://engine.example///",
    ]) {
      vi.stubEnv("PROFILE_ENGINE_URL", configured);
      const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 422 }));
      vi.stubGlobal("fetch", fetchMock);
      await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_CALCULATION_REJECTED");
      expect(fetchMock.mock.calls[0]?.[0], `configured as ${configured}`).toBe(
        "https://engine.example/v1/profile/compute",
      );
    }
  });

  it("refuses an address that names an endpoint instead of the service", async () => {
    vi.stubEnv("PROFILE_ENGINE_URL", "https://engine.example/health");
    vi.stubGlobal("fetch", vi.fn());
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_MISCONFIGURED");
  });

  it("leaves a local development address alone", () => {
    vi.stubEnv("PROFILE_ENGINE_URL", "");
    expect(profileEngineBaseUrl()).toBe("http://127.0.0.1:8000");
  });
});

describe("a service that was only waking up", () => {
  /**
   * A staging instance that suspends when idle cannot answer its first request
   * inside the deadline a running one needs. The person who arrives first was
   * told the calculation could not complete, when their request was what woke
   * the service.
   */
  it("retries once when the first attempt times out, and succeeds", async () => {
    const payload = {
      completeness: "core",
      numerology: {
        name_calculation_status: "available",
        life_path: 7,
        expression: 5,
        soul_urge: 3,
        personality: 2,
        birthday: 6,
        name_rendering: null,
        transformation: "steady",
        algorithm_version: "v1",
      },
      dreamspell: {
        kin: 12,
        tone: 12,
        tone_name: "Crystal",
        solar_seal: 12,
        solar_seal_name: "Human",
        color: "blue",
        algorithm_version: "v1",
        certification_status: "pending",
      },
      western_astrology: {
        status: "unavailable",
        capability: "",
        reason: "",
        activation_requirements: [],
      },
      bazi: { status: "unavailable", capability: "", reason: "", activation_requirements: [] },
      traits: [],
      tensions: [],
    };
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await calculateProfile(INPUT);
    expect(result.numerology.life_path).toBe(7);
    expect(fetchMock, "the waking request is retried exactly once").toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry rather than waiting indefinitely", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abort);
    vi.stubGlobal("fetch", fetchMock);
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_TIMEOUT");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries an unreachable service once too", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("connection refused"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(calculateProfile(INPUT)).rejects.toThrow("PROFILE_ENGINE_UNAVAILABLE");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
