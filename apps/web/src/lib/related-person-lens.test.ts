import type { ProfileSnapshot, ProfileTrait } from "@starguidance/contracts";
import type { StoredRelationshipProfileVersion } from "@starguidance/database";
import { describe, expect, it } from "vitest";

import {
  buildRelatedPersonReadingLens,
  personMentionHandles,
  personMentionToken,
} from "./related-person-lens";

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

  it("derives short first-name handles and disambiguates shared first names", () => {
    const handles = personMentionHandles([
      { id: "a", fullName: "Maya Angelou Chen" },
      { id: "b", fullName: "John Michael Smith" },
      { id: "c", fullName: "John Park" },
      { id: "d", fullName: "Jo" },
    ]);
    expect(Object.fromEntries(handles)).toEqual({
      a: "@maya",
      b: "@john-s",
      c: "@john-p",
      d: "@jo",
    });
  });

  it("falls back to the full-name handle when initials also collide", () => {
    const handles = personMentionHandles([
      { id: "a", fullName: "Sam Lee" },
      { id: "b", fullName: "Sam Lo" },
    ]);
    expect(Object.fromEntries(handles)).toEqual({ a: "@sam-lee", b: "@sam-lo" });
  });

  it("resolves the short first-name handle", () => {
    const lens = buildRelatedPersonReadingLens("How can I support @john this month?", [
      candidate(),
    ]);
    expect(lens?.profiles[0]?.mention).toBe("@john");
  });

  it.each(["Why has @john-smith been distant?", "Why has @John Smith been distant?"])(
    "keeps the original full-name mention working in %s",
    (question) => {
      const lens = buildRelatedPersonReadingLens(question, [candidate()]);
      expect(lens).toEqual({
        version: "related-person-reading-lens-v1",
        profiles: [
          {
            profileId,
            snapshotId,
            mention: question.includes("@john-smith") ? "@john-smith" : "@john",
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
