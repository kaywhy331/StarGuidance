import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalBirthplaceSchema = z.string().trim().max(200).optional();

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
});

export const profileTensionSchema = z.object({
  id: z.string().min(1),
  sideA: z.string().min(1),
  sideB: z.string().min(1),
  traitIndexes: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
});

export const profileSnapshotSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  version: z.number().int().positive(),
  completeness: profileCompletenessSchema,
  traits: z.array(profileTraitSchema).readonly(),
  tensions: z.array(profileTensionSchema).readonly(),
  calculationVersions: z.record(z.string(), z.string()),
  createdAt: z.string().datetime(),
});

export type ProfileSnapshot = z.infer<typeof profileSnapshotSchema>;
export type ProfileTrait = z.infer<typeof profileTraitSchema>;
export type ProfileTension = z.infer<typeof profileTensionSchema>;
