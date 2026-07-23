import { NextResponse } from "next/server";
import { birthProfileInputSchema } from "@starguidance/contracts";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { recordAudit, saveLocalProfile } from "@/lib/local-store";
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
    if (!user.consentRecords.some(({ version }) => version === input.consentVersion))
      user.consentRecords.push({
        version: input.consentVersion,
        grantedAt: new Date().toISOString(),
      });
    const snapshot = saveLocalProfile(user, input, calculation);
    recordAudit("profile.snapshot.created", user.id, snapshot.id);
    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PROFILE_CALCULATION_REJECTED")
      return NextResponse.json(
        {
          error:
            "The calculation could not use these inputs. Non-Latin birth names require a user-confirmed Latin-letter rendering.",
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
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json(
      { error: status === 401 ? "Authentication required." : "Invalid birth profile." },
      { status },
    );
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({
      profile: user.profile
        ? {
            snapshot: user.profile.snapshot,
            maskedName: user.profile.maskedName,
            birthDate: user.profile.birthDate,
            timeKind: user.profile.timeKind,
            birthplaceLabel: user.profile.birthplaceLabel,
          }
        : null,
    });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
