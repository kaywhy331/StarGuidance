import { NextResponse } from "next/server";
import { birthProfileInputSchema } from "@starguidance/contracts";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit, saveProfileVersion } from "@/lib/persistence";
import { calculateProfile } from "@/lib/profile-engine";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";

const profileRequestSchema = birthProfileInputSchema.and(
  z.object({ consentVersion: z.literal("privacy-reflective-v1") }),
);

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertSameOrigin(request);
    assertRateLimit(`profile:${user.id}`, 8);
    const input = profileRequestSchema.parse(await request.json());
    const calculation = await calculateProfile(input);
    const persistence = persistenceFor(user);
    if (!user.consentRecords.some(({ version }) => version === input.consentVersion))
      await persistence.repositories.consents.grant(user.id, {
        policy: "privacy-reflective",
        version: input.consentVersion,
        grantedAt: new Date().toISOString(),
      });
    const snapshot = await saveProfileVersion(user, input, calculation);
    await recordAudit(user.id, "profile.snapshot.created", "profile_snapshot", snapshot.id);
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_CALCULATION_REJECTED")
      return NextResponse.json(
        {
          error: "The calculation could not use these birth details.",
        },
        { status: 422 },
      );
    if (error instanceof Error && error.message === "PROFILE_ENGINE_UNAVAILABLE")
      return NextResponse.json(
        {
          error:
            "The private profile engine could not complete the calculation. Your profile was not changed; retry when it is available.",
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
    const profile = await persistenceFor(user).repositories.birthProfiles.getActive(user.id);
    return NextResponse.json({
      profile: profile
        ? {
            snapshot: profile.snapshot,
            maskedName: profile.maskedName,
            birthDate: profile.birthDate,
            birthTimeProvided: profile.timeKind !== "unknown",
            birthplaceLabel: profile.birthplaceLabel,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
