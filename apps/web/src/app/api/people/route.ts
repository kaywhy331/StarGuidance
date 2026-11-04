import { NextResponse } from "next/server";
import { birthProfileInputSchema } from "@starguidance/contracts";
import { z } from "zod";

import { assertCurrentPolicyConsents, POLICY_RECONSENT_REQUIRED, requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit, saveRelationshipProfileVersion } from "@/lib/persistence";
import { calculateProfile } from "@/lib/profile-engine";
import { personMentionHandles, personMentionToken } from "@/lib/related-person-lens";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeConfiguration } from "@/lib/runtime-configuration";

const MAX_RELATED_PROFILES = 20;

const personProfileInputSchema = birthProfileInputSchema.extend({
  profileId: z.string().uuid().optional(),
  permissionConfirmed: z.literal(true),
});

const deletionSchema = z.object({ profileId: z.string().uuid() }).strict();

function enabledProfileSystems(
  systems: readonly ("numerology" | "dreamspell" | "western" | "bazi" | "nine-star-ki")[],
) {
  const sourceSystemByFlag = {
    numerology: "numerology",
    dreamspell: "dreamspell",
    western: "westernAstrology",
    bazi: "bazi",
    "nine-star-ki": "nineStarKi",
  } as const;
  return systems.flatMap((system) => {
    const source = sourceSystemByFlag[system];
    return system === "western" ? [source, "planetaryAngularity" as const] : [source];
  });
}

export async function GET() {
  try {
    const user = await requireUser();
    const persistence = persistenceFor(user);
    const profiles = await persistence.repositories.relationshipProfiles.listActive(user.id);
    const decoded = profiles.map((profile) => ({
      profile,
      input: birthProfileInputSchema.parse(
        JSON.parse(persistence.decrypt(profile.encryptedInput, "related-person-profile-input")),
      ),
    }));
    const handles = personMentionHandles(
      decoded.map(({ profile, input }) => ({
        id: profile.relationshipProfileId,
        fullName: input.fullBirthName,
      })),
    );
    return NextResponse.json(
      {
        profiles: decoded.map(({ profile, input }) => {
          const fullMention = personMentionToken(input.fullBirthName);
          const mention = handles.get(profile.relationshipProfileId) ?? fullMention;
          return {
            id: profile.relationshipProfileId,
            snapshotId: profile.snapshot.id,
            version: profile.snapshot.version,
            name: input.fullBirthName,
            mention,
            ...(mention !== fullMention ? { fullMention } : {}),
            birthDate: input.birthDate,
            birthplace: input.birthplace,
            birthTime: input.birthTime,
            completeness: profile.snapshot.completeness,
            updatedAt: profile.snapshot.createdAt,
          };
        }),
        limit: MAX_RELATED_PROFILES,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "The people you’ve saved couldn’t be loaded just now." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    assertCurrentPolicyConsents(user);
    await assertRateLimit(`people-profile:${user.id}`, 12, 60 * 60 * 1000);
    const input = personProfileInputSchema.parse(await request.json());
    const persistence = persistenceFor(user);
    const profiles = await persistence.repositories.relationshipProfiles.listActive(user.id);
    const existing = input.profileId
      ? await persistence.repositories.relationshipProfiles.getActive(user.id, input.profileId)
      : undefined;
    if (input.profileId && !existing)
      return NextResponse.json({ error: "Person profile not found." }, { status: 404 });
    if (!existing && profiles.length >= MAX_RELATED_PROFILES)
      return NextResponse.json(
        { error: `You can keep up to ${MAX_RELATED_PROFILES} people profiles.` },
        { status: 409 },
      );

    const requestedMention = personMentionToken(input.fullBirthName);
    const others = profiles
      .filter((profile) => profile.relationshipProfileId !== input.profileId)
      .map((profile) => ({
        id: profile.relationshipProfileId,
        fullName: birthProfileInputSchema.parse(
          JSON.parse(persistence.decrypt(profile.encryptedInput, "related-person-profile-input")),
        ).fullBirthName,
      }));
    const duplicate = others.find(
      ({ fullName }) => personMentionToken(fullName) === requestedMention,
    );
    if (duplicate)
      return NextResponse.json(
        {
          error: `You’ve already saved someone with this name. Edit their profile instead.`,
        },
        { status: 409 },
      );

    const calculation = await calculateProfile(input);
    const runtime = await getRuntimeConfiguration();
    const snapshot = await saveRelationshipProfileVersion(
      user,
      input,
      calculation,
      enabledProfileSystems(runtime.features.enabledProfileSystems),
      existing,
    );
    await recordAudit(
      user.id,
      existing ? "relationship_profile.snapshot.created" : "relationship_profile.created",
      "relationship_profile",
      snapshot.profileId,
    );
    const before = personMentionHandles(others);
    const after = personMentionHandles([
      ...others,
      { id: snapshot.profileId, fullName: input.fullBirthName },
    ]);
    const changedMentions = others.flatMap(({ id }) => {
      const from = before.get(id);
      const to = after.get(id);
      return from && to && from !== to ? [{ from, to }] : [];
    });
    return NextResponse.json(
      {
        ...(changedMentions.length > 0 ? { changedMentions } : {}),
        profile: {
          id: snapshot.profileId,
          snapshotId: snapshot.id,
          version: snapshot.version,
          name: input.fullBirthName,
          mention: after.get(snapshot.profileId) ?? requestedMention,
          birthDate: input.birthDate,
          birthplace: input.birthplace,
          birthTime: input.birthTime,
          completeness: snapshot.completeness,
          updatedAt: snapshot.createdAt,
        },
      },
      { status: existing ? 200 : 201, headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error: "Check the name and birth details, then confirm you have permission to save them.",
        },
        { status: 422 },
      );
    if (error instanceof Error && error.message === POLICY_RECONSENT_REQUIRED)
      return NextResponse.json(
        { error: "Review the current service policies before saving a person profile." },
        { status: 428 },
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const profileEngineFailure =
      error instanceof Error &&
      [
        "PROFILE_CALCULATION_REJECTED",
        "PROFILE_ENGINE_UNAVAILABLE",
        "PROFILE_ENGINE_TIMEOUT",
        "PROFILE_ENGINE_CONTRACT_MISMATCH",
        "PROFILE_ENGINE_MISCONFIGURED",
      ].includes(error.message);
    return NextResponse.json(
      {
        error: profileEngineFailure
          ? "We couldn’t work out their profile just now. Nothing was saved — please try again in a moment."
          : "The person profile could not be saved.",
      },
      { status: profileEngineFailure ? 503 : 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`people-profile-delete:${user.id}`, 20, 60 * 60 * 1000);
    const input = deletionSchema.parse(await request.json());
    const deleted = await persistenceFor(user).repositories.relationshipProfiles.delete(
      user.id,
      input.profileId,
    );
    if (!deleted) return NextResponse.json({ error: "Person profile not found." }, { status: 404 });
    await recordAudit(
      user.id,
      "relationship_profile.deleted",
      "relationship_profile",
      input.profileId,
    );
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid person profile." }, { status: 422 });
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "The person profile could not be deleted." },
      { status: 500 },
    );
  }
}
