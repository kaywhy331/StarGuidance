import { CALCULATION_SYSTEM_VERSIONS } from "@starguidance/contracts";
import { describe, expect, it } from "vitest";

import {
  buildProfileReportSections,
  createProfileReportSource,
  type ProfileReportSource,
} from "./report";
import { PROFILE_REPORT_SECTION_PREVIEW } from "./report-sections";

const source: ProfileReportSource = {
  snapshot: {
    id: "548e8158-2b54-4d28-a6bd-b6a4223f820b",
    profileId: "f312677a-88af-4765-95bb-50c61f185a8b",
    version: 3,
    completeness: "core",
    ontologyVersion: "profile-traits-v4",
    traits: [
      {
        domain: "coreMotivation",
        statement: "Autonomy can be energizing.",
        sourceSystem: "numerology",
        sourceRule: "life-path-1",
        calculationVersion: CALCULATION_SYSTEM_VERSIONS.numerology,
        stability: "stable",
        direction: "supportive",
        strength: 0.9,
        confidence: "high",
        lifeDomains: ["general", "career"],
      },
      {
        domain: "coreMotivation",
        statement: "Collaboration can restore perspective.",
        sourceSystem: "dreamspell",
        sourceRule: "tone-2",
        calculationVersion: CALCULATION_SYSTEM_VERSIONS.dreamspell,
        stability: "stable",
        direction: "supportive",
        strength: 0.6,
        confidence: "medium",
        lifeDomains: ["general"],
      },
      {
        domain: "growthLever",
        statement: "Try a reversible experiment before committing.",
        sourceSystem: "nineStarKi",
        sourceRule: "principal-1",
        calculationVersion: CALCULATION_SYSTEM_VERSIONS.nineStarKi,
        stability: "uncertain",
        direction: "mixed",
        strength: 0.4,
        confidence: "low",
        lifeDomains: ["change"],
      },
    ],
    tensions: [
      {
        id: "autonomy_vs_collaboration",
        sideA: "You may want room to decide independently.",
        sideB: "You may also benefit from shared confirmation.",
        traitIndexes: [0, 1],
        lifeDomains: ["general", "relationships"],
      },
    ],
    convergences: [
      {
        id: "core-motivation-reflection-v1",
        domain: "coreMotivation",
        summary: "Both represented systems invite a balance between autonomy and perspective.",
        traitIndexes: [0, 1],
        sourceSystems: ["numerology", "dreamspell"],
        confidence: "medium",
      },
    ],
    calculationVersions: { ...CALCULATION_SYSTEM_VERSIONS },
    createdAt: "2026-08-10T00:00:00.000Z",
  },
  calculation: {
    completeness: "core",
    ontology_version: "profile-traits-v4",
    numerology: {
      name_calculation_status: "available",
      life_path: 1,
      expression: 3,
      soul_urge: 2,
      personality: 1,
      birthday: 4,
      name_rendering: "Synthetic Person",
      transformation: "latin-basic",
      algorithm_version: CALCULATION_SYSTEM_VERSIONS.numerology,
    },
    dreamspell: {
      kin: 34,
      tone: 8,
      tone_name: "Galactic",
      solar_seal: 14,
      solar_seal_name: "Wizard",
      color: "White",
      algorithm_version: CALCULATION_SYSTEM_VERSIONS.dreamspell,
      certification_status: "pending-certification",
    },
    nine_star_ki: {
      principal_star: { number: 1, phase: "water" },
      character_star: { number: 2, phase: "earth" },
      energy_star: { number: 3, phase: "wood" },
      boundary_convention: "fixed-civil-date",
      third_star_convention: "lo-shu-derived",
      algorithm_version: CALCULATION_SYSTEM_VERSIONS.nineStarKi,
      interpretation_version: "nine-star-ki-traits-v1",
      certification_status: "pending-certification",
    },
    western_astrology: {
      status: "unavailable",
      capability: "western_astrology",
      reason: "validated_engine_required",
      calculation_version: CALCULATION_SYSTEM_VERSIONS.westernAstrology,
      activation_requirements: ["licensed ephemeris"],
    },
    bazi: {
      status: "unavailable",
      capability: "bazi_four_pillars",
      reason: "validated_engine_required",
      calculation_version: CALCULATION_SYSTEM_VERSIONS.bazi,
      activation_requirements: ["golden references"],
    },
    planetary_angularity: {
      status: "unavailable",
      capability: "planetary_angularity_map",
      reason: "precise_birth_time_required",
      calculation_version: CALCULATION_SYSTEM_VERSIONS.planetaryAngularity,
      activation_requirements: ["birth time"],
    },
    traits: [],
    tensions: [],
    convergences: [],
  },
};

describe("profile report template", () => {
  it("renders every previewed section exactly once and keeps unavailable systems explicit", () => {
    const sections = buildProfileReportSections(source);

    expect(sections.map(({ key, title }) => ({ key, title }))).toEqual(
      PROFILE_REPORT_SECTION_PREVIEW,
    );
    expect(sections.filter(({ unavailable }) => unavailable).map(({ key }) => key)).toEqual([
      "astrology",
      "bazi",
      "planetary-angularity",
    ]);
  });

  it("retains trait provenance, cross-system agreement, and both sides of a tension", () => {
    const sections = buildProfileReportSections(source);
    const motivations = sections.find(({ key }) => key === "core-motivations")?.body ?? "";
    const convergence = sections.find(({ key }) => key === "cross-system-convergence")?.body ?? "";
    const contradictions =
      sections.find(({ key }) => key === "cross-system-contradictions")?.body ?? "";

    expect(motivations).toContain("life-path-1");
    expect(motivations).toContain(CALCULATION_SYSTEM_VERSIONS.numerology);
    expect(convergence).toContain("Autonomy can be energizing.");
    expect(convergence).toContain("Collaboration can restore perspective.");
    expect(contradictions).toContain("decide independently");
    expect(contradictions).toContain("shared confirmation");
  });

  it("removes the name rendering from the durable background source", () => {
    const prepared = createProfileReportSource(source.snapshot, source.calculation);

    expect(prepared.calculation.numerology.name_rendering).toBeNull();
    expect(JSON.stringify(prepared)).not.toContain("Synthetic Person");
  });
});
