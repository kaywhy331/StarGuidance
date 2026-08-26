import "server-only";

import { selectReadingLens } from "@starguidance/ai";
import type { BirthProfileInput } from "@starguidance/contracts";
import type { StoredRelationshipProfileVersion } from "@starguidance/database";
import { z } from "zod";

export const relatedPersonReadingLensSchema = z
  .object({
    version: z.literal("related-person-reading-lens-v1"),
    profiles: z
      .array(
        z
          .object({
            profileId: z.string().uuid(),
            snapshotId: z.string().uuid(),
            mention: z.string().startsWith("@").max(201),
            traitStatements: z.array(z.string().min(1).max(500)).max(3).readonly(),
          })
          .strict(),
      )
      .max(3)
      .readonly(),
  })
  .strict();

export type RelatedPersonReadingLens = z.infer<typeof relatedPersonReadingLensSchema>;

export interface RelationshipProfileCandidate {
  readonly input: BirthProfileInput;
  readonly profile: StoredRelationshipProfileVersion;
}

export function personMentionToken(fullName: string): string {
  const token = fullName
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `@${token}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isExplicitlyMentioned(question: string, fullName: string): boolean {
  const token = personMentionToken(fullName).slice(1);
  const spacedName = escapeRegExp(fullName.trim()).replace(/\s+/g, "\\s+");
  const matcher = new RegExp(
    `(^|[\\s([{])@(?:${escapeRegExp(token)}|${spacedName})(?=$|[\\s.,!?;:)'\\]}])`,
    "iu",
  );
  return matcher.test(question.normalize("NFKC"));
}

/** Resolves explicit @mentions only. The result contains a minimized trait
 * lens and immutable snapshot IDs—never birth inputs or calculation payloads. */
export function buildRelatedPersonReadingLens(
  question: string,
  candidates: readonly RelationshipProfileCandidate[],
): RelatedPersonReadingLens | undefined {
  const profiles = [...candidates]
    .sort((left, right) => right.input.fullBirthName.length - left.input.fullBirthName.length)
    .filter(({ input }) => isExplicitlyMentioned(question, input.fullBirthName))
    .slice(0, 3)
    .map(({ input, profile }) => ({
      profileId: profile.relationshipProfileId,
      snapshotId: profile.snapshot.id,
      mention: personMentionToken(input.fullBirthName),
      traitStatements: selectReadingLens(
        question,
        profile.snapshot.traits,
        profile.snapshot.tensions,
        "relationships",
      ).statements.slice(0, 3),
    }));
  return profiles.length === 0
    ? undefined
    : relatedPersonReadingLensSchema.parse({
        version: "related-person-reading-lens-v1",
        profiles,
      });
}

export function parseRelatedPersonReadingLens(value: string): RelatedPersonReadingLens {
  return relatedPersonReadingLensSchema.parse(JSON.parse(value));
}

export function relatedPersonProviderContext(lens: RelatedPersonReadingLens | undefined) {
  return (lens?.profiles ?? []).map(({ mention, traitStatements }) => ({
    mention,
    relevantTraitStatements: traitStatements,
  }));
}
