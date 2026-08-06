import { describe, expect, it } from "vitest";
import type { ProfileSnapshot } from "@starguidance/contracts";

import { profileDerivedPayload } from "./profile-storage";

describe("profile snapshot plaintext boundary", () => {
  it("does not persist submitted birth facts in the derived JSON payload", () => {
    const birthDate = "1984-06-19";
    const birthplace = "Private Place, California";
    const snapshot: ProfileSnapshot = {
      id: "00000000-0000-4000-8000-000000000001",
      profileId: "00000000-0000-4000-8000-000000000002",
      version: 1,
      completeness: "complete",
      traits: [],
      tensions: [],
      calculationVersions: {
        numerology: "test-v1",
        dreamspell: "test-v1",
        nineStarKi: "test-v1",
        westernAstrology: "test-v1",
        bazi: "test-v1",
        planetaryAngularity: "test-v1",
      },
      createdAt: "2026-08-05T00:00:00.000Z",
    };

    const persistedPlaintext = JSON.stringify(profileDerivedPayload(snapshot));

    expect(persistedPlaintext).not.toContain(birthDate);
    expect(persistedPlaintext).not.toContain(birthplace);
    expect(Object.keys(profileDerivedPayload(snapshot))).toEqual(["snapshot"]);
  });
});
