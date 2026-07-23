import { z } from "zod";

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const clockPattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const birthplaceSchema = z.object({
  city: z.string().trim().min(1).max(120),
  region: z.string().trim().max(120).optional(),
  countryCode: z.string().trim().length(2).toUpperCase(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  timeZone: z.string().trim().min(1).max(100),
});

export const birthTimeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("exact"), time: z.string().regex(clockPattern) }),
  z
    .object({
      kind: z.literal("approximate"),
      start: z.string().regex(clockPattern),
      end: z.string().regex(clockPattern),
    })
    .refine(({ start, end }) => start < end, {
      message: "The approximate range end must be later than its start on the same day.",
      path: ["end"],
    }),
]);

export const birthProfileInputSchema = z
  .object({
    fullBirthName: z.string().trim().min(2).max(200),
    birthDate: z.string().regex(isoDatePattern, "Use an ISO date in YYYY-MM-DD format."),
    birthplace: birthplaceSchema.optional(),
    authoritativeTimeZone: z.string().trim().min(1).max(100).optional(),
    birthTime: birthTimeSchema,
    latinNameRendering: z.string().trim().min(2).max(200).optional(),
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

    if (
      profile.birthTime.kind !== "unknown" &&
      !profile.birthplace &&
      !profile.authoritativeTimeZone
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Birthplace or authoritative timezone context is required when a birth time is supplied.",
        path: ["birthplace"],
      });
    }
  });

export const profileCompletenessSchema = z.enum([
  "core",
  "locationEnhanced",
  "approximateTime",
  "complete",
]);

export type BirthProfileInput = z.infer<typeof birthProfileInputSchema>;
export type BirthTime = z.infer<typeof birthTimeSchema>;
export type ProfileCompleteness = z.infer<typeof profileCompletenessSchema>;

export function getProfileCompleteness(profile: BirthProfileInput): ProfileCompleteness {
  if (profile.birthTime.kind === "exact") return "complete";
  if (profile.birthTime.kind === "approximate") return "approximateTime";
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

export const profileTraitSchema = z.object({
  domain: traitDomainSchema,
  statement: z.string().min(1),
  sourceSystem: z.enum(["numerology", "dreamspell", "westernAstrology", "bazi"]),
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
