import { NextResponse } from "next/server";
import {
  classifyQuestion,
  classifyFollowUpScope,
  createFollowUpStreamEvents,
  DeterministicFallbackProvider,
} from "@starguidance/ai";
import { z } from "zod";

import { assertCurrentPolicyConsents, POLICY_RECONSENT_REQUIRED, requireUser } from "@/lib/auth";
import { guestContinuationInputSchema } from "@/lib/guest-reading-contract";
import {
  GuestTrialConfigurationError,
  issueGuestReadingHandoff,
  issueGuestReadingReceipt,
  verifyGuestReadingHandoff,
  verifyGuestReadingReceipt,
} from "@/lib/guest-reading-security";
import { guestReadingDisplay, receiptPayloadFromHandoff } from "@/lib/guest-reading-server";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

const expiredMessage = "Your saved guest reading expired after 7 days.";

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
    if (input.action === "redeem") {
      // A confirmation email opened in another browser carries only the
      // compact handoff; rebuild the same cards and hand this browser a full
      // receipt so follow-ups work here too.
      const handoff = verifyGuestReadingHandoff(input.handoff);
      if (!handoff)
        return noStore(
          NextResponse.json({ error: expiredMessage, expired: true }, { status: 410 }),
        );
      const payload = await receiptPayloadFromHandoff(handoff);
      const issued = issueGuestReadingReceipt(payload, Date.parse(payload.createdAt));
      return noStore(
        NextResponse.json({
          reading: guestReadingDisplay(payload, { includeResult: true }),
          receipt: issued.receipt,
          handoff: input.handoff,
        }),
      );
    }
    const receipt = verifyGuestReadingReceipt(input.receipt);
    if (!receipt)
      return noStore(NextResponse.json({ error: expiredMessage, expired: true }, { status: 410 }));
    if (input.action === "recover")
      return noStore(
        NextResponse.json({
          reading: guestReadingDisplay(receipt, { includeResult: true }),
          handoff: issueGuestReadingHandoff(receipt),
        }),
      );

    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return noStore(NextResponse.json({ safety }, { status: 422 }));
    const scope = classifyFollowUpScope({
      originalQuestion: receipt.question,
      originalClassification: receipt.questionClassification,
      followUpQuestion: input.question,
    });
    if (!scope.sameReading)
      return noStore(
        NextResponse.json(
          {
            error: "That’s a new question — it deserves its own fresh cards.",
            newReadingRequired: true,
            reason: scope.reason,
          },
          { status: 409 },
        ),
      );
    const generated = await new DeterministicFallbackProvider().generateFollowUpWithProvenance({
      draw: receipt.draw,
      configuration: receipt.configuration,
      question: input.question,
      questionClassification: receipt.questionClassification,
      relevantTraitStatements: receipt.readerLens,
      originalResult: receipt.result,
    });
    return noStore(
      NextResponse.json({
        followUp: generated.result,
        previewEvents: createFollowUpStreamEvents(generated.result),
        personalizedByPrivateProfile:
          receipt.configuration.personalizationMode === "personalized_tarot" &&
          receipt.readerLens.length > 0,
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
          { error: "Saved guest readings aren’t available right now." },
          { status: 503 },
        ),
      );
    if (error instanceof Error && error.message === POLICY_RECONSENT_REQUIRED)
      return noStore(
        NextResponse.json(
          { error: "Please review our updated policies before asking a follow-up." },
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
        NextResponse.json(
          { error: "Something in that request didn’t look right. Please try again." },
          { status: 422 },
        ),
      );
    return noStore(
      NextResponse.json(
        { error: "These cards couldn’t answer just now. Please try again." },
        { status: 500 },
      ),
    );
  }
}
