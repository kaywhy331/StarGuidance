import { CALCULATION_SYSTEM_VERSIONS } from "@starguidance/contracts";
import { describe, expect, it } from "vitest";

import { REGISTERED_CALCULATION_VERSIONS } from "../src/calculation-version-registry";

/**
 * The registry join (gap G26): every version a snapshot can record — which
 * the pinned profile-engine contract limits to exactly the canonical map —
 * must be registered by the seed. This guards the one hand-maintained step
 * (the registry rows) against drifting from the shared constants.
 */
describe("calculation-version registry", () => {
  it("registers exactly one row per canonical system, carrying the canonical version", () => {
    const registered = new Map<string, string>(
      REGISTERED_CALCULATION_VERSIONS.map((row) => [row.system, row.version]),
    );
    expect(registered.size).toBe(REGISTERED_CALCULATION_VERSIONS.length);
    expect([...registered.keys()].sort()).toEqual(Object.keys(CALCULATION_SYSTEM_VERSIONS).sort());
    for (const [system, version] of Object.entries(CALCULATION_SYSTEM_VERSIONS))
      expect(registered.get(system), `${system} must register its emitted version`).toBe(version);
  });

  it("gives every registered row a recognised certification status", () => {
    for (const row of REGISTERED_CALCULATION_VERSIONS)
      expect(["implemented", "pending-certification", "unavailable"]).toContain(row.status);
  });
});
