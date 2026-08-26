import type { ProfileSnapshot, ProfileTrait } from "@starguidance/contracts";
import type { StoredRelationshipProfileVersion } from "@starguidance/database";
import { describe, expect, it } from "vitest";

import { buildRelatedPersonReadingLens, personMentionToken } from "./related-person-lens";

const profileId = "10000000-0000-4000-8000-000000000001";
const snapshotId = "20000000-0000-4000-8000-000000000001";

function trait(statement: string): ProfileTrait {
  return {
    domain: "conflictResponse",
    statement,
    sourceSystem: "numerology",
    sourceRule: "test-rule",
    calculationVersion: "test-v1",
    stability: "stable",
    direction: "mixed",
    strength: 0.8,
    confidence: "high",
    lifeDomains: ["relationships"],
  };
}

function candidate(name = "John Smith") {
  const snapshot: ProfileSnapshot = {
    id: snapshotId,
    profileId,
    version: 1,
    completeness: "core",
    ontologyVersion: "ontology-v1",
    traits: [trait("May hold a position firmly once conflict begins.")],
    tensions: [],
    convergences: [],
    enabledSystems: ["numerology"],
    calculationVersions: { numerology: "test-v1" },
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  return {
    input: { fullBirthName: name, birthDate: "1990-05-10" },
    profile: {
      relationshipProfileId: profileId,
      encryptedInput: "encrypted-input",
      encryptedCalculations: "encrypted-calculations",
      snapshot,
    } satisfies StoredRelationshipProfileVersion,
  };
}

describe("related person reading lens", () => {
  it("creates Unicode-safe private handles without transliteration", () => {
    expect(personMentionToken("John  Smith")).toBe("@john-smith");
    expect(personMentionToken("李 小龍")).toBe("@李-小龍");
  });

  it.each(["Why has @john-smith been distant?", "Why has @John Smith been distant?"])(
    "resolves only an explicit full-name mention in %s",
    (question) => {
      const lens = buildRelatedPersonReadingLens(question, [candidate()]);
      expect(lens).toEqual({
        version: "related-person-reading-lens-v1",
        profiles: [
          {
            profileId,
            snapshotId,
            mention: "@john-smith",
            traitStatements: ["May hold a position firmly once conflict begins."],
          },
        ],
      });
      expect(JSON.stringify(lens)).not.toContain("1990-05-10");
    },
  );

  it("does not infer a profile from an unmarked name", () => {
    expect(
      buildRelatedPersonReadingLens("Why has John Smith been distant?", [candidate()]),
    ).toBeUndefined();
  });
});
