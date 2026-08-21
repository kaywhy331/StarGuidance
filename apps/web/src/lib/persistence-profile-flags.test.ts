import type { ProfileConvergence, ProfileTension, ProfileTrait } from "@starguidance/contracts";
import { describe, expect, it } from "vitest";

import { filterProfileOntologyBySystem } from "./persistence";

function trait(sourceSystem: ProfileTrait["sourceSystem"], statement: string): ProfileTrait {
  return {
    domain: "coreMotivation",
    statement,
    sourceSystem,
    sourceRule: `${sourceSystem}-rule`,
    calculationVersion: `${sourceSystem}-v1`,
    stability: "stable",
    direction: "supportive",
    strength: 0.8,
    confidence: "high",
    lifeDomains: ["general"],
  };
}

const mappedTraits = [
  trait("numerology", "Numerology observation"),
  trait("dreamspell", "Dreamspell observation"),
  trait("westernAstrology", "Astrology observation"),
];
const mappedTensions: ProfileTension[] = [
  {
    id: "num-dream",
    sideA: "First",
    sideB: "Second",
    traitIndexes: [0, 1],
    lifeDomains: ["general"],
  },
  {
    id: "num-western",
    sideA: "First",
    sideB: "Third",
    traitIndexes: [0, 2],
    lifeDomains: ["general"],
  },
];
const mappedConvergences: ProfileConvergence[] = [
  {
    id: "num-dream",
    domain: "coreMotivation",
    summary: "Two enabled sources agree.",
    traitIndexes: [0, 1],
    sourceSystems: ["numerology", "dreamspell"],
    confidence: "medium",
  },
  {
    id: "num-western",
    domain: "coreMotivation",
    summary: "A disabled source once participated.",
    traitIndexes: [0, 2],
    sourceSystems: ["numerology", "westernAstrology"],
    confidence: "medium",
  },
];

describe("profile-system feature flags", () => {
  it("removes disabled traits and every ontology edge that would dangle", () => {
    const filtered = filterProfileOntologyBySystem(
      { mappedTraits, mappedTensions, mappedConvergences },
      ["numerology", "dreamspell"],
    );

    expect(filtered.traits.map(({ sourceSystem }) => sourceSystem)).toEqual([
      "numerology",
      "dreamspell",
    ]);
    expect(filtered.tensions).toEqual([mappedTensions[0]]);
    expect(filtered.convergences).toEqual([mappedConvergences[0]]);
  });

  it("remaps retained indexes when a middle trait is disabled", () => {
    const filtered = filterProfileOntologyBySystem(
      { mappedTraits, mappedTensions, mappedConvergences },
      ["numerology", "westernAstrology"],
    );
    expect(filtered.tensions).toEqual([
      expect.objectContaining({ id: "num-western", traitIndexes: [0, 1] }),
    ]);
    expect(filtered.convergences).toEqual([
      expect.objectContaining({ id: "num-western", traitIndexes: [0, 1] }),
    ]);
  });
});
