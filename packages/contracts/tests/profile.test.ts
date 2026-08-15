import { describe, expect, it } from "vitest";

import {
  baziResultSchema,
  birthProfileInputSchema,
  CALCULATION_SYSTEM_VERSIONS,
  getProfileCompleteness,
  planetaryAngularityResultSchema,
  profileTraitSchema,
  westernAstrologyResultSchema,
} from "../src/profile";

const core = {
  fullBirthName: "Ada Lovelace",
  birthDate: "1815-12-10",
};

describe("birth profile contract", () => {
  it("accepts date-only core profiles", () => {
    const parsed = birthProfileInputSchema.parse(core);
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("accepts a birth time without birthplace or timezone context", () => {
    const parsed = birthProfileInputSchema.parse({
      ...core,
      birthTime: "08:15",
    });
    expect(parsed.birthTime).toBe("08:15");
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("accepts the two optional fields as simple values", () => {
    const parsed = birthProfileInputSchema.parse({
      ...core,
      birthplace: "London, United Kingdom",
      birthTime: "07:00",
    });
    expect(parsed.birthplace).toBe("London, United Kingdom");
    expect(parsed.birthTime).toBe("07:00");
    expect(getProfileCompleteness(parsed)).toBe("complete");
  });

  it("accepts blank optional values", () => {
    const parsed = birthProfileInputSchema.parse({ ...core, birthplace: "  ", birthTime: "" });
    expect(parsed.birthplace).toBeUndefined();
    expect(parsed.birthTime).toBe("");
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("rejects a one-character birthplace before calling the profile engine", () => {
    const parsed = birthProfileInputSchema.safeParse({ ...core, birthplace: "X" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(["birthplace"]);
  });

  it("preserves Unicode names", () => {
    expect(birthProfileInputSchema.parse({ ...core, fullBirthName: "李" }).fullBirthName).toBe(
      "李",
    );
  });
});

describe("optional profile-system provenance", () => {
  it.each(["planetaryAngularity", "nineStarKi"] as const)(
    "accepts %s only as explicit versioned trait provenance",
    (sourceSystem) => {
      expect(
        profileTraitSchema.parse({
          domain: "decisionStyle",
          statement: "Synthetic original editorial observation.",
          sourceSystem,
          sourceRule: "synthetic-reference-rule",
          calculationVersion: "synthetic-v1",
          stability: "uncertain",
        }).sourceSystem,
      ).toBe(sourceSystem);
    },
  );
});

describe("future calculation activation contracts", () => {
  const evidence = {
    engine_name: "synthetic-contract-engine",
    engine_version: "1.0.0",
    data_version: "synthetic-data-v1",
    convention_version: "synthetic-conventions-v1",
    source_attribution: ["Synthetic contract fixture; not calculation evidence."],
  };
  const uncertainty = { status: "stable" as const, reasons: [] };
  const resolved_context = {
    instant_utc: "2000-01-01T12:00:00.000Z",
    timezone_id: "Etc/UTC",
    utc_offset_seconds: 0,
    latitude_degrees: 0,
    longitude_degrees: 0,
    resolution_method: "synthetic-contract-fixture",
  };
  const signs = [
    "aries",
    "taurus",
    "gemini",
    "cancer",
    "leo",
    "virgo",
    "libra",
    "scorpio",
    "sagittarius",
    "capricorn",
    "aquarius",
    "pisces",
  ];
  const cusps = signs.map((sign, index) => ({
    house: index + 1,
    longitude_degrees: index * 30,
    sign,
    degree_in_sign: 0,
  }));

  it("validates an evidenced Western astrology result without weakening unavailable states", () => {
    const available = westernAstrologyResultSchema.parse({
      status: "available",
      capability: "western_astrology",
      calculation_version: CALCULATION_SYSTEM_VERSIONS.westernAstrology,
      evidence,
      uncertainty,
      resolved_context,
      zodiac: "tropical",
      planetary_positions: [
        {
          body: "sun",
          longitude_degrees: 280,
          latitude_degrees: 0,
          sign: "capricorn",
          degree_in_sign: 10,
          retrograde: false,
        },
      ],
      aspects: [],
      angles: {
        ascendant: { longitude_degrees: 0, sign: "aries", degree_in_sign: 0 },
        midheaven: { longitude_degrees: 270, sign: "capricorn", degree_in_sign: 0 },
      },
      house_systems: {
        whole_sign: { status: "available", system: "whole_sign", cusps },
        placidus: { status: "unavailable", system: "placidus", reason: "unsupported_latitude" },
      },
    });
    expect(available.status).toBe("available");

    expect(
      westernAstrologyResultSchema.parse({
        status: "unavailable",
        capability: "western_astrology",
        reason: "unlicensed_and_unvalidated",
        calculation_version: CALCULATION_SYSTEM_VERSIONS.westernAstrology,
        activation_requirements: ["approved license"],
      }).status,
    ).toBe("unavailable");
  });

  it("requires all four BaZi pillars and explicit boundary conventions", () => {
    const result = baziResultSchema.parse({
      status: "available",
      capability: "bazi_four_pillars",
      calculation_version: CALCULATION_SYSTEM_VERSIONS.bazi,
      evidence,
      uncertainty,
      resolved_context,
      pillars: {
        year: { heavenly_stem: "geng", earthly_branch: "chen" },
        month: { heavenly_stem: "wu", earthly_branch: "zi" },
        day: { heavenly_stem: "wu", earthly_branch: "wu" },
        hour: { heavenly_stem: "wu", earthly_branch: "wu" },
      },
      conventions: {
        calendar_input: "proleptic_gregorian",
        year_boundary: "li_chun",
        month_boundary: "jie_solar_terms",
        solar_term_model: "apparent_solar_longitude",
        timezone_handling: "historical_civil_time",
        true_solar_time: "not_applied",
        zi_hour_day_boundary: "23:00",
      },
      solar_term_context: {
        previous_name: "synthetic-previous",
        previous_instant_utc: "1999-12-22T00:00:00.000Z",
        next_name: "synthetic-next",
        next_instant_utc: "2000-01-06T00:00:00.000Z",
      },
    });
    expect(result.status).toBe("available");
  });

  it("requires versioned WGS84 angular lines for an available map", () => {
    const result = planetaryAngularityResultSchema.parse({
      status: "available",
      capability: "planetary_angularity_map",
      calculation_version: CALCULATION_SYSTEM_VERSIONS.planetaryAngularity,
      evidence,
      uncertainty,
      resolved_context,
      coordinate_reference_system: "WGS84",
      orb_policy_degrees: 1,
      interpretation_policy_version: "synthetic-policy-v1",
      lines: [
        {
          line_id: "sun-rising-1",
          body: "sun",
          angle: "rising",
          segments: [
            [
              { latitude_degrees: -10, longitude_degrees: 20 },
              { latitude_degrees: 10, longitude_degrees: 25 },
            ],
          ],
        },
      ],
      crossings: [],
    });
    expect(result.status).toBe("available");
    expect(
      planetaryAngularityResultSchema.safeParse({ ...result, evidence: undefined }).success,
    ).toBe(false);
  });
});
