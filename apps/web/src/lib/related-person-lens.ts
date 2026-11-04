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

function mentionSlug(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The original full-name handle (e.g. `@john-michael-smith`). It stays valid
 * in questions forever so handles people already learned keep working.
 */
export function personMentionToken(fullName: string): string {
  return `@${mentionSlug(fullName)}`;
}

function nameParts(fullName: string): string[] {
  return mentionSlug(fullName).split("-").filter(Boolean);
}

export interface MentionCandidate {
  readonly id: string;
  readonly fullName: string;
}

/**
 * Short, friendly handles derived from each person's first name: `@maya`.
 * When two saved people share a first name, the last-name initial is added
 * (`@john-s`), and if that still collides the full-name handle is used.
 * Handles are derived, never stored, so no migration is needed; the full-name
 * handle is always accepted as well.
 */
export function personMentionHandles(candidates: readonly MentionCandidate[]): Map<string, string> {
  const firstOf = (name: string) => nameParts(name)[0] ?? mentionSlug(name);
  const initialed = (name: string) => {
    const parts = nameParts(name);
    const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
    return last ? `${parts[0]}-${Array.from(last)[0]}` : undefined;
  };
  const count = (values: readonly (string | undefined)[], value: string | undefined) =>
    values.filter((candidate) => candidate === value).length;
  const firsts = candidates.map(({ fullName }) => firstOf(fullName));
  const initials = candidates.map(({ fullName }) => initialed(fullName));
  const fulls = candidates.map(({ fullName }) => mentionSlug(fullName));
  const handles = new Map<string, string>();
  candidates.forEach(({ id }, index) => {
    const first = firsts[index]!;
    const initial = initials[index];
    const full = fulls[index]!;
    // A short handle must not equal anyone else's full-name handle either.
    if (count(firsts, first) === 1 && count(fulls, first) <= (first === full ? 1 : 0))
      handles.set(id, `@${first}`);
    else if (initial && count(initials, initial) === 1 && !fulls.includes(initial))
      handles.set(id, `@${initial}`);
    else handles.set(id, `@${full}`);
  });
  return handles;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionMatcher(alternatives: readonly string[]): RegExp {
  return new RegExp(`(^|[\\s([{])@(?:${alternatives.join("|")})(?=$|[\\s.,!?;:)'\\]}])`, "iu");
}

/** Returns the handle form the question actually used, or undefined. */
function explicitMention(question: string, fullName: string, handle: string): string | undefined {
  const normalized = question.normalize("NFKC");
  const legacy = personMentionToken(fullName);
  if (mentionMatcher([escapeRegExp(handle.slice(1))]).test(normalized)) return handle;
  if (mentionMatcher([escapeRegExp(legacy.slice(1))]).test(normalized)) return legacy;
  const spacedName = escapeRegExp(fullName.trim()).replace(/\s+/g, "\\s+");
  return mentionMatcher([spacedName]).test(normalized) ? handle : undefined;
}

/** Resolves explicit @mentions only. The result contains a minimized trait
 * lens and immutable snapshot IDs—never birth inputs or calculation payloads. */
export function buildRelatedPersonReadingLens(
  question: string,
  candidates: readonly RelationshipProfileCandidate[],
): RelatedPersonReadingLens | undefined {
  const handles = personMentionHandles(
    candidates.map(({ input, profile }) => ({
      id: profile.relationshipProfileId,
      fullName: input.fullBirthName,
    })),
  );
  const profiles = [...candidates]
    .sort((left, right) => right.input.fullBirthName.length - left.input.fullBirthName.length)
    .flatMap((candidate) => {
      const handle =
        handles.get(candidate.profile.relationshipProfileId) ??
        personMentionToken(candidate.input.fullBirthName);
      const mention = explicitMention(question, candidate.input.fullBirthName, handle);
      return mention ? [{ ...candidate, mention }] : [];
    })
    .slice(0, 3)
    .map(({ profile, mention }) => ({
      profileId: profile.relationshipProfileId,
      snapshotId: profile.snapshot.id,
      mention,
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
