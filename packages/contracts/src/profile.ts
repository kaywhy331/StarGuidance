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

export const profileCompletenessSchema = z.enum([
  "core",
  "locationEnhanced",
  "approximateTime",
  "complete",
]);

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
export type ProfileTension = z.infer<typeof profileTensionSchema>;
