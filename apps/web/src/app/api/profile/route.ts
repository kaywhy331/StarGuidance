import { NextResponse } from "next/server";
import { birthProfileInputSchema } from "@starguidance/contracts";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit, saveProfileVersion } from "@/lib/persistence";
import { POLICY_VERSIONS } from "@/lib/policies";
import { calculateProfile } from "@/lib/profile-engine";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

const profileRequestSchema = birthProfileInputSchema.and(
  z.object({ consentVersion: z.literal(POLICY_VERSIONS.profilePersonalization) }),
);
const profileDeletionSchema = z.object({ confirmation: z.literal("DELETE PROFILE") });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`profile:${user.id}`, 8);
    const input = profileRequestSchema.parse(await request.json());
    const calculation = await calculateProfile(input);
    const persistence = persistenceFor(user);
    if (!user.consentRecords.some(({ version }) => version === input.consentVersion))
      await persistence.repositories.consents.grant(user.id, {
        policy: "profile-personalization",
        version: input.consentVersion,
        grantedAt: new Date().toISOString(),
      });
    const snapshot = await saveProfileVersion(user, input, calculation);
    await recordAudit(user.id, "profile.snapshot.created", "profile_snapshot", snapshot.id);
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof Error && error.message === "PROFILE_CALCULATION_REJECTED")
      return NextResponse.json(
        {
          error: "The calculation could not use these birth details.",
        },
        { status: 422 },
      );
    // Same message either way — the person cannot act on the distinction — but
    // the reason code lets an operator tell a slow service from a changed
    // contract from an unreachable one. It names a condition, never a value.
    const engineFailure =
      error instanceof Error &&
      [
        "PROFILE_ENGINE_UNAVAILABLE",
        "PROFILE_ENGINE_TIMEOUT",
        "PROFILE_ENGINE_CONTRACT_MISMATCH",
        "PROFILE_ENGINE_MISCONFIGURED",
      ].includes(error.message);
    if (engineFailure)
      return NextResponse.json(
        {
          error:
            "The private profile engine could not complete the calculation. Your profile was not changed; retry when it is available.",
          reason: (error as Error).message,
        },
        { status: 503 },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json(
        { error: "Check the four birth-profile fields and try again." },
        { status: 422 },
      );
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 503;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "Authentication required."
            : "The private profile could not be saved. Your existing profile was not changed.",
      },
      { status },
    );
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const persistence = persistenceFor(user);
    const profile = await persistence.repositories.birthProfiles.getActive(user.id);
    const input = profile
      ? birthProfileInputSchema.parse(
          JSON.parse(persistence.decrypt(profile.encryptedInput, "profile-input")),
        )
      : undefined;
    return NextResponse.json({
      profile:
        profile && input
          ? {
              snapshot: profile.snapshot,
              maskedName: `${input.fullBirthName.slice(0, 1)}${"•".repeat(
                Math.min(input.fullBirthName.length - 1, 8),
              )}`,
              birthDate: input.birthDate,
              birthTimeProvided: Boolean(input.birthTime),
              birthplaceLabel: input.birthplace,
            }
          : null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "The private profile could not be loaded." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`profile-delete:${user.id}`, 3, 60 * 60 * 1000);
    profileDeletionSchema.parse(await request.json());
    const deleted = await persistenceFor(user).repositories.birthProfiles.delete(user.id);
    if (!deleted) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    await recordAudit(user.id, "profile.deleted", "account", user.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: 'Type "DELETE PROFILE" to confirm.' }, { status: 422 });
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "The private profile could not be deleted." },
      { status: 500 },
    );
  }
}
