import { describe, expect, it } from "vitest";

import { assertServiceBaseUrl, findServiceUrlProblem } from "./service-url";

describe("service base URL configuration", () => {
  it("accepts a base service URL", () => {
    for (const value of [
      "https://profile-engine.example",
      "https://profile-engine.example/",
      "https://profile-engine.example/api",
    ]) {
      expect(findServiceUrlProblem("PROFILE_ENGINE_URL", value)).toBeUndefined();
    }
  });

  it("rejects a value that is already an endpoint of the service", () => {
    for (const suffix of ["/health", "/health/", "/v1/profile/compute", "/healthz", "/ping"]) {
      const problem = findServiceUrlProblem(
        "PROFILE_ENGINE_URL",
        `https://profile-engine.example${suffix}`,
      );
      expect(problem, `${suffix} must be rejected`).toBeDefined();
      expect(problem?.reason).toMatch(/endpoint of the service/);
    }
  });

  it("rejects values that are not usable base URLs at all", () => {
    expect(findServiceUrlProblem("PROFILE_ENGINE_URL", "")?.reason).toMatch(/empty/);
    expect(findServiceUrlProblem("PROFILE_ENGINE_URL", "profile-engine.example")?.reason).toMatch(
      /absolute/,
    );
    expect(findServiceUrlProblem("PROFILE_ENGINE_URL", "http://engine.example")?.reason).toMatch(
      /https/,
    );
    expect(
      findServiceUrlProblem("PROFILE_ENGINE_URL", "https://engine.example?x=1")?.reason,
    ).toMatch(/query string/);
  });

  it("normalises an accepted value by removing trailing slashes", () => {
    expect(assertServiceBaseUrl("PROFILE_ENGINE_URL", "https://engine.example//")).toBe(
      "https://engine.example",
    );
  });

  it("names the variable in the failure so an operator knows what to correct", () => {
    expect(() =>
      assertServiceBaseUrl("PROFILE_ENGINE_URL", "https://engine.example/health"),
    ).toThrow(/PROFILE_ENGINE_URL/);
  });
});
