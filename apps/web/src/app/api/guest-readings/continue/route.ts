import { NextResponse } from "next/server";
import {
  classifyQuestion,
  createFollowUpStreamEvents,
  DeterministicFallbackProvider,
  selectReadingLens,
} from "@starguidance/ai";
import { z } from "zod";

import { assertCurrentPolicyConsents, POLICY_RECONSENT_REQUIRED, requireUser } from "@/lib/auth";
import { guestContinuationInputSchema } from "@/lib/guest-reading-contract";
import {
  GuestTrialConfigurationError,
  verifyGuestReadingReceipt,
} from "@/lib/guest-reading-security";
import { guestReadingDisplay } from "@/lib/guest-reading-server";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "action" in body &&
      body.action === "followUp" &&
      "question" in body &&
      typeof body.question === "string"
    ) {
      const crisisSafety = classifyQuestion(body.question);
      if (crisisSafety.category === "selfHarmCrisis")
        return noStore(NextResponse.json({ safety: crisisSafety }, { status: 422 }));
    }
    const input = guestContinuationInputSchema.parse(body);
    const user = await requireUser();
    assertCurrentPolicyConsents(user);
    await assertRateLimit(`guest-continuation:${user.id}`, 8, 60 * 60 * 1_000);
    const receipt = verifyGuestReadingReceipt(input.receipt);
    if (!receipt)
      return noStore(
        NextResponse.json(
          { error: "This guest-reading handoff has expired or changed." },
          { status: 410 },
        ),
      );
    if (input.action === "recover")
      return noStore(NextResponse.json({ reading: guestReadingDisplay(receipt) }));

    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return noStore(NextResponse.json({ safety }, { status: 422 }));
    const snapshot = user.profile?.snapshot;
    const lens = selectReadingLens(
      input.question,
      snapshot?.traits ?? [],
      snapshot?.tensions ?? [],
      receipt.questionClassification.topic,
    );
    const generated = await new DeterministicFallbackProvider().generateFollowUpWithProvenance({
      draw: receipt.draw,
      question: input.question,
      questionClassification: receipt.questionClassification,
      relevantTraitStatements: lens.statements,
      originalResult: receipt.result,
    });
    return noStore(
      NextResponse.json({
        followUp: generated.result,
        previewEvents: createFollowUpStreamEvents(generated.result),
        personalizedByPrivateProfile: Boolean(snapshot && lens.statements.length > 0),
      }),
    );
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return noStore(
        NextResponse.json(
          { error: security.error },
          { status: security.status, headers: security.headers },
        ),
      );
    if (error instanceof GuestTrialConfigurationError)
      return noStore(
        NextResponse.json(
          { error: "Guest-reading continuation is not configured." },
          { status: 503 },
        ),
      );
    if (error instanceof Error && error.message === POLICY_RECONSENT_REQUIRED)
      return noStore(
        NextResponse.json(
          { error: "Review the current service policies before asking a follow-up." },
          { status: 428 },
        ),
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return noStore(
        NextResponse.json(
          { error: "Create or sign in to an account to continue." },
          { status: 401 },
        ),
      );
    if (error instanceof z.ZodError)
      return noStore(
        NextResponse.json({ error: "The guest-reading continuation is invalid." }, { status: 422 }),
      );
    return noStore(
      NextResponse.json(
        { error: "The same-draw follow-up could not be prepared." },
        { status: 500 },
      ),
    );
  }
}
