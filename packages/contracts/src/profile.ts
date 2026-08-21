import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalBirthplaceSchema = z
  .string()
  .trim()
  .max(200)
  .refine(
    (value) => value.length === 0 || value.length >= 2,
    "Enter at least 2 characters for a birthplace.",
  )
  .transform((value) => value || undefined)
  .optional();

const optionalBirthTimeSchema = z
  .string()
  .trim()
  .refine((value) => value.length === 0 || clockPattern.test(value), "Enter a valid birth time.")
  .optional();

export const birthProfileInputSchema = z
  .object({
    fullBirthName: z.string().trim().min(1).max(200),
    birthDate: z.string().regex(isoDatePattern, "Use an ISO date in YYYY-MM-DD format."),
    birthplace: optionalBirthplaceSchema,
    birthTime: optionalBirthTimeSchema,
  })
  .superRefine((profile, context) => {
    const parsedDate = new Date(`${profile.birthDate}T00:00:00.000Z`);
    if (
      Number.isNaN(parsedDate.valueOf()) ||
      parsedDate.toISOString().slice(0, 10) !== profile.birthDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Enter a real calendar date.",
        path: ["birthDate"],
      });
    } else if (parsedDate > new Date()) {
      context.addIssue({
        code: "custom",
        message: "Birth date cannot be in the future.",
        path: ["birthDate"],
      });
    }
  });

export const profileCompletenessSchema = z.enum(["core", "locationEnhanced", "complete"]);

export type BirthProfileInput = z.infer<typeof birthProfileInputSchema>;
export type ProfileCompleteness = z.infer<typeof profileCompletenessSchema>;

export function getProfileCompleteness(profile: BirthProfileInput): ProfileCompleteness {
  if (profile.birthTime && profile.birthplace) return "complete";
  if (profile.birthplace) return "locationEnhanced";
  return "core";
}

export const traitDomainSchema = z.enum([
  "coreMotivation",
  "emotionalProcessing",
  "communicationStyle",
  "decisionStyle",
  "socialOrientation",
  "relationshipNeeds",
  "riskOrientation",
  "stabilityVsChange",
  "conflictResponse",
  "workStyle",
  "creativeExpression",
  "repeatingTension",
  "growthLever",
]);

export const profileLifeDomainSchema = z.enum([
  "general",
  "career",
  "relationships",
  "change",
  "creativity",
]);

export const traitDirectionSchema = z.enum(["supportive", "challenging", "mixed"]);
export const traitConfidenceSchema = z.enum(["low", "medium", "high"]);

/**
 * The single authoritative map of calculation-system versions (gap G26).
 * Everything that names a version derives from here: the profile engine's
 * response contract pins these exact literals at the web boundary
 * (apps/web/src/lib/profile-engine-contract.ts), and the seed registers
 * exactly these rows into calculation_versions
 * (packages/database/src/calculation-version-registry.ts) — so every version
 * a snapshot can ever record is guaranteed to exist in the registry, and a
 * version bump that edits only one side fails loudly instead of silently
 * breaking the snapshot↔registry join (CAL-014 reproducibility).
 *
 * The values must match what apps/profile-engine actually emits
 * (numerology.py, dreamspell.py, nine_star_ki.py, planetary_angularity.py,
 * main.py's unavailable envelopes); the pinned contract turns any divergence
 * into an immediate 502 in staging rather than a quietly unjoined snapshot.
 */
export const CALCULATION_SYSTEM_VERSIONS = {
  numerology: "pythagorean-v3",
  dreamspell: "dreamspell-anchor-1987-07-26-kin34-no-leap-v2",
  nineStarKi: "nine-star-ki-fixed-boundaries-lo-shu-v1",
  westernAstrology: "western-astrology-contract-v1",
  bazi: "bazi-contract-v1",
  planetaryAngularity: "planetary-angularity-contract-v1",
} as const;

export const calculationEvidenceSchema = z.object({
  engine_name: z.string().min(1),
  engine_version: z.string().min(1),
  data_version: z.string().min(1),
  convention_version: z.string().min(1),
  source_attribution: z.array(z.string().min(1)).min(1).readonly(),
});

export const calculationUncertaintySchema = z.object({
  status: z.enum(["stable", "uncertain"]),
  reasons: z.array(z.string().min(1)).readonly(),
});

export const resolvedCalculationContextSchema = z.object({
  instant_utc: z.string().datetime({ offset: true }),
  timezone_id: z.string().min(1),
  utc_offset_seconds: z.number().int().min(-64_800).max(64_800),
  latitude_degrees: z.number().min(-90).max(90),
  longitude_degrees: z.number().min(-180).max(180),
  resolution_method: z.string().min(1),
});

function unavailableCalculationSchema(capability: string, calculationVersion: string) {
  return z.object({
    status: z.literal("unavailable"),
    capability: z.literal(capability),
    reason: z.string().min(1),
    calculation_version: z.literal(calculationVersion),
    activation_requirements: z.array(z.string().min(1)).min(1).readonly(),
  });
}

export const zodiacSignSchema = z.enum([
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
]);

export const celestialBodySchema = z.enum([
  "sun",
  "moon",
  "mercury",
  "venus",
  "mars",
  "jupiter",
  "saturn",
  "uranus",
  "neptune",
  "pluto",
  "north_node",
  "south_node",
  "chiron",
]);

const eclipticPointSchema = z.object({
  longitude_degrees: z.number().min(0).lt(360),
  sign: zodiacSignSchema,
  degree_in_sign: z.number().min(0).lt(30),
});

const westernPlanetaryPositionSchema = eclipticPointSchema.extend({
  body: celestialBodySchema,
  latitude_degrees: z.number().min(-90).max(90),
  retrograde: z.boolean(),
});

const westernAspectSchema = z.object({
  body_a: celestialBodySchema,
  body_b: celestialBodySchema,
  aspect: z.enum(["conjunction", "opposition", "trine", "square", "sextile", "quincunx"]),
  exact_angle_degrees: z.number().min(0).max(180),
  orb_degrees: z.number().min(0).max(30),
  applying: z.boolean().nullable(),
});

const houseCuspSchema = eclipticPointSchema.extend({
  house: z.number().int().min(1).max(12),
});

const wholeSignHousesSchema = z.object({
  status: z.literal("available"),
  system: z.literal("whole_sign"),
  cusps: z.array(houseCuspSchema).length(12).readonly(),
});

const placidusHousesSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    system: z.literal("placidus"),
    cusps: z.array(houseCuspSchema).length(12).readonly(),
  }),
  z.object({
    status: z.literal("unavailable"),
    system: z.literal("placidus"),
    reason: z.enum(["unsupported_latitude", "calculation_failed"]),
  }),
]);

export const westernAstrologyUnavailableSchema = unavailableCalculationSchema(
  "western_astrology",
  CALCULATION_SYSTEM_VERSIONS.westernAstrology,
);

export const westernAstrologyAvailableSchema = z.object({
  status: z.literal("available"),
  capability: z.literal("western_astrology"),
  calculation_version: z.literal(CALCULATION_SYSTEM_VERSIONS.westernAstrology),
  evidence: calculationEvidenceSchema,
  uncertainty: calculationUncertaintySchema,
  resolved_context: resolvedCalculationContextSchema,
  zodiac: z.literal("tropical"),
  planetary_positions: z.array(westernPlanetaryPositionSchema).min(1).readonly(),
  aspects: z.array(westernAspectSchema).readonly(),
  angles: z.object({
    ascendant: eclipticPointSchema,
    midheaven: eclipticPointSchema,
  }),
  house_systems: z.object({
    whole_sign: wholeSignHousesSchema,
    placidus: placidusHousesSchema,
  }),
});

export const westernAstrologyResultSchema = z.discriminatedUnion("status", [
  westernAstrologyUnavailableSchema,
  westernAstrologyAvailableSchema,
]);

export const heavenlyStemSchema = z.enum([
  "jia",
  "yi",
  "bing",
  "ding",
  "wu",
  "ji",
  "geng",
  "xin",
  "ren",
  "gui",
]);

export const earthlyBranchSchema = z.enum([
  "zi",
  "chou",
  "yin",
  "mao",
  "chen",
  "si",
  "wu",
  "wei",
  "shen",
  "you",
  "xu",
  "hai",
]);

const baziPillarSchema = z.object({
  heavenly_stem: heavenlyStemSchema,
  earthly_branch: earthlyBranchSchema,
});

export const baziUnavailableSchema = unavailableCalculationSchema(
  "bazi_four_pillars",
  CALCULATION_SYSTEM_VERSIONS.bazi,
);

export const baziAvailableSchema = z.object({
  status: z.literal("available"),
  capability: z.literal("bazi_four_pillars"),
  calculation_version: z.literal(CALCULATION_SYSTEM_VERSIONS.bazi),
  evidence: calculationEvidenceSchema,
  uncertainty: calculationUncertaintySchema,
  resolved_context: resolvedCalculationContextSchema,
  pillars: z.object({
    year: baziPillarSchema,
    month: baziPillarSchema,
    day: baziPillarSchema,
    hour: baziPillarSchema,
  }),
  conventions: z.object({
    calendar_input: z.enum(["proleptic_gregorian", "proleptic_julian"]),
    year_boundary: z.enum(["li_chun", "lunar_new_year"]),
    month_boundary: z.literal("jie_solar_terms"),
    solar_term_model: z.enum(["apparent_solar_longitude", "mean_solar_longitude"]),
    timezone_handling: z.literal("historical_civil_time"),
    true_solar_time: z.enum(["applied", "not_applied"]),
    zi_hour_day_boundary: z.enum(["23:00", "00:00"]),
  }),
  solar_term_context: z.object({
    previous_name: z.string().min(1),
    previous_instant_utc: z.string().datetime({ offset: true }),
    next_name: z.string().min(1),
    next_instant_utc: z.string().datetime({ offset: true }),
  }),
});

export const baziResultSchema = z.discriminatedUnion("status", [
  baziUnavailableSchema,
  baziAvailableSchema,
]);

const geographicPointSchema = z.object({
  latitude_degrees: z.number().min(-90).max(90),
  longitude_degrees: z.number().min(-180).max(180),
});

const angularityLineSchema = z.object({
  line_id: z.string().min(1),
  body: celestialBodySchema,
  angle: z.enum(["rising", "setting", "culminating", "anti_culminating"]),
  segments: z.array(z.array(geographicPointSchema).min(2).readonly()).min(1).readonly(),
});

export const planetaryAngularityUnavailableSchema = unavailableCalculationSchema(
  "planetary_angularity_map",
  CALCULATION_SYSTEM_VERSIONS.planetaryAngularity,
);

export const planetaryAngularityAvailableSchema = z.object({
  status: z.literal("available"),
  capability: z.literal("planetary_angularity_map"),
  calculation_version: z.literal(CALCULATION_SYSTEM_VERSIONS.planetaryAngularity),
  evidence: calculationEvidenceSchema,
  uncertainty: calculationUncertaintySchema,
  resolved_context: resolvedCalculationContextSchema,
  coordinate_reference_system: z.literal("WGS84"),
  orb_policy_degrees: z.number().min(0).max(30),
  interpretation_policy_version: z.string().min(1),
  lines: z.array(angularityLineSchema).min(1).readonly(),
  crossings: z
    .array(
      z.object({
        line_a_id: z.string().min(1),
        line_b_id: z.string().min(1),
        point: geographicPointSchema,
      }),
    )
    .readonly(),
});

export const planetaryAngularityResultSchema = z.discriminatedUnion("status", [
  planetaryAngularityUnavailableSchema,
  planetaryAngularityAvailableSchema,
]);

export type WesternAstrologyResult = z.infer<typeof westernAstrologyResultSchema>;
export type BaziResult = z.infer<typeof baziResultSchema>;
export type PlanetaryAngularityResult = z.infer<typeof planetaryAngularityResultSchema>;

export const profileTraitSchema = z.object({
  domain: traitDomainSchema,
  statement: z.string().min(1),
  sourceSystem: z.enum([
    "numerology",
    "dreamspell",
    "westernAstrology",
    "bazi",
    "planetaryAngularity",
    "nineStarKi",
  ]),
  sourceRule: z.string().min(1),
  calculationVersion: z.string().min(1),
  stability: z.enum(["stable", "uncertain", "unavailable"]),
  direction: traitDirectionSchema.default("mixed"),
  strength: z.number().min(0).max(1).default(0.5),
  confidence: traitConfidenceSchema.default("medium"),
  lifeDomains: z.array(profileLifeDomainSchema).min(1).readonly().default(["general"]),
});

export const profileTensionSchema = z.object({
  id: z.string().min(1),
  sideA: z.string().min(1),
  sideB: z.string().min(1),
  traitIndexes: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
  lifeDomains: z.array(profileLifeDomainSchema).min(1).readonly().default(["general"]),
});

export const profileConvergenceSchema = z.object({
  id: z.string().min(1),
  domain: traitDomainSchema,
  summary: z.string().min(1),
  traitIndexes: z.array(z.number().int().nonnegative()).min(2).readonly(),
  sourceSystems: z.array(profileTraitSchema.shape.sourceSystem).min(2).readonly(),
  confidence: traitConfidenceSchema,
});

export const profileSnapshotSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  version: z.number().int().positive(),
  completeness: profileCompletenessSchema,
  ontologyVersion: z.string().min(1).default("profile-traits-v3"),
  traits: z.array(profileTraitSchema).readonly(),
  tensions: z.array(profileTensionSchema).readonly(),
  convergences: z.array(profileConvergenceSchema).readonly().default([]),
  enabledSystems: z.array(profileTraitSchema.shape.sourceSystem).readonly().optional(),
  calculationVersions: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
});

export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>;
export type ProfileTrait = z.infer<typeof profileTraitSchema>;
export type ProfileTension = z.infer<typeof profileTensionSchema>;
export type ProfileConvergence = z.infer<typeof profileConvergenceSchema>;
export type ProfileLifeDomain = z.infer<typeof profileLifeDomainSchema>;
