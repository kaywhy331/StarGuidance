import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { classifyQuestion, createFollowUpStreamEvents } from "@starguidance/ai";
import type { ReadingSessionRepository, StoredFollowUp } from "@starguidance/database";
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
import {
  answerGuestFollowUp,
  guestReadingDisplay,
  guestReadingIdempotencyKey,
  receiptPayloadFromHandoff,
  storedGuestReading,
} from "@/lib/guest-reading-server";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

const expiredMessage = "Your saved guest reading expired after 7 days.";
const newQuestionMessage = "That’s a new question — it deserves its own fresh cards.";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}

/** The history entry this account already made from a guest reading, if any.
 * Best effort: recovering the cards never depends on the account store. */
async function savedReadingId(
  readingSessions: () => ReadingSessionRepository,
  userId: string,
  guestReadingId: string,
): Promise<string | undefined> {
  try {
    const saved = await readingSessions().getByIdempotencyKey(
      userId,
      guestReadingIdempotencyKey(guestReadingId),
    );
    return saved?.id;
  } catch {
    return undefined;
  }
}

function saveFailure(error: unknown): NextResponse {
  if (error instanceof Error && error.message === "GUEST_READING_SAVED_ELSEWHERE")
    return NextResponse.json(
      { error: "This free reading is already saved in another account.", savedElsewhere: true },
      { status: 409 },
    );
  if (error instanceof Error && error.message === "READING_CONTENT_UNAVAILABLE")
    return NextResponse.json(
      { error: "This reading can’t be saved right now. It’s still kept here for 7 days." },
      { status: 409 },
    );
  return NextResponse.json(
    { error: "Your reading couldn’t be saved just now. It’s still kept here — please try again." },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body: unknown = await request.json();
    // Crisis language interrupts before authentication, whichever action
    // carries the reader's own words.
    const readerText =
      typeof body === "object" && body !== null && "action" in body
        ? body.action === "followUp" && "question" in body
          ? body.question
          : body.action === "save" && "followUpQuestion" in body
            ? body.followUpQuestion
            : undefined
        : undefined;
    if (typeof readerText === "string") {
      const crisisSafety = classifyQuestion(readerText);
      if (crisisSafety.category === "selfHarmCrisis")
        return noStore(NextResponse.json({ safety: crisisSafety }, { status: 422 }));
    }
    const input = guestContinuationInputSchema.parse(body);
    const user = await requireUser();
    assertCurrentPolicyConsents(user);
    await assertRateLimit(`guest-continuation:${user.id}`, 8, 60 * 60 * 1_000);
    const readingSessions = () => persistenceFor(user).repositories.readingSessions;
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
      const saved = await savedReadingId(readingSessions, user.id, payload.readingId);
      return noStore(
        NextResponse.json({
          reading: guestReadingDisplay(payload, { includeResult: true }),
          receipt: issued.receipt,
          handoff: input.handoff,
          ...(saved ? { savedReadingId: saved } : {}),
        }),
      );
    }
    const receipt = verifyGuestReadingReceipt(input.receipt);
    if (!receipt)
      return noStore(NextResponse.json({ error: expiredMessage, expired: true }, { status: 410 }));
    if (input.action === "recover") {
      const saved = await savedReadingId(readingSessions, user.id, receipt.readingId);
      return noStore(
        NextResponse.json({
          reading: guestReadingDisplay(receipt, { includeResult: true }),
          handoff: issueGuestReadingHandoff(receipt),
          ...(saved ? { savedReadingId: saved } : {}),
        }),
      );
    }

    if (input.action === "save") {
      // The reader asked for this; nothing saves a guest reading silently.
      const safety = classifyQuestion(receipt.question);
      if (safety.interrupt) return noStore(NextResponse.json({ safety }, { status: 422 }));
      const persistence = persistenceFor(user);
      const answered = input.followUpQuestion
        ? await answerGuestFollowUp(receipt, input.followUpQuestion)
        : undefined;
      let saved;
      try {
        const existing = await persistence.repositories.readingSessions.getByIdempotencyKey(
          user.id,
          guestReadingIdempotencyKey(receipt.readingId),
        );
        const followUp: StoredFollowUp | undefined =
          answered?.kind === "answered" && input.followUpQuestion
            ? {
                id: randomUUID(),
                encryptedQuestion: persistence.encrypt(
                  input.followUpQuestion,
                  "follow-up-question",
                ),
                result: answered.result,
                outputProvenance: answered.provenance,
                createdAt: new Date().toISOString(),
              }
            : undefined;
        if (existing) {
          // An earlier save whose reply was lost may predate this follow-up;
          // keep the reader's answered question rather than dropping it. A
          // retry never adds a second one.
          if (followUp && existing.followUps.length === 0)
            await persistence.repositories.followUps
              .create(user.id, existing.id, followUp, { limit: 1 })
              .catch((error: unknown) => {
                // A concurrent retry already attached it.
                if (!(error instanceof Error && error.message === "FOLLOW_UP_LIMIT_REACHED"))
                  throw error;
              });
          return noStore(NextResponse.json({ readingId: existing.id, alreadySaved: true }));
        }
        saved = await persistence.repositories.readingSessions.importGuestReading(
          storedGuestReading({
            userId: user.id,
            receipt,
            encryptedQuestion: persistence.encrypt(receipt.question, "reading-question"),
            safetyClassification: safety.category,
            followUp,
          }),
        );
      } catch (error) {
        return noStore(saveFailure(error));
      }
      await recordAudit(user.id, "reading.guest_saved", "reading", saved.id);
      return noStore(
        NextResponse.json({ readingId: saved.id, alreadySaved: false }, { status: 201 }),
      );
    }

    const answered = await answerGuestFollowUp(receipt, input.question);
    if (answered.kind === "interrupted")
      return noStore(NextResponse.json({ safety: answered.safety }, { status: 422 }));
    if (answered.kind === "newReadingRequired")
      return noStore(
        NextResponse.json(
          { error: newQuestionMessage, newReadingRequired: true, reason: answered.reason },
          { status: 409 },
        ),
      );
    return noStore(
      NextResponse.json({
        followUp: answered.result,
        previewEvents: createFollowUpStreamEvents(answered.result),
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
          { error: "Please review our updated policies before continuing with this reading." },
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
