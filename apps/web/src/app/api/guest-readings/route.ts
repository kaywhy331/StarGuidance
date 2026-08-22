import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  classifyQuestion,
  classifyQuestionContext,
  DeterministicFallbackProvider,
  GUARDED_CATEGORIES,
} from "@starguidance/ai";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import { z } from "zod";

import {
  GUEST_DEVICE_HEADER,
  guestDeviceIdSchema,
  guestReadingInputSchema,
  guestReceiptPayloadSchema,
} from "@/lib/guest-reading-contract";
import {
  assertGuestTrialConfigured,
  GUEST_TRIAL_COOKIE,
  GUEST_TRIAL_COOKIE_TTL_SECONDS,
  GuestTrialConfigurationError,
  guestTrialNetworkRateLimitKey,
  issueGuestReadingReceipt,
  issueGuestTrialMarker,
  verifyGuestTrialMarker,
} from "@/lib/guest-reading-security";
import { guestDateLensStatements } from "@/lib/guest-date-lens";
import { guestReadingDisplay } from "@/lib/guest-reading-server";
import {
  assertRateLimit,
  assertSameOrigin,
  clientRateLimitKey,
  requestSecurityFailure,
} from "@/lib/request-security";

function noStore(response: NextResponse): NextResponse {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("vary", "cookie");
  return response;
}

function guestDevice(request: Request): string {
  return guestDeviceIdSchema.parse(request.headers.get(GUEST_DEVICE_HEADER));
}

async function markerState(request: Request): Promise<{
  deviceId: string;
  marker?: string;
  valid: boolean;
}> {
  const deviceId = guestDevice(request);
  const marker = (await cookies()).get(GUEST_TRIAL_COOKIE)?.value;
  return {
    deviceId,
    ...(marker ? { marker } : {}),
    valid: verifyGuestTrialMarker(marker, deviceId),
  };
}

export async function GET(request: Request) {
  try {
    assertGuestTrialConfigured();
    const marker = await markerState(request);
    return noStore(
      NextResponse.json({
        eligible: !marker.marker,
        signupRequired: Boolean(marker.marker),
        markerValid: marker.valid,
      }),
    );
  } catch (error) {
    if (error instanceof GuestTrialConfigurationError)
      return noStore(
        NextResponse.json(
          { error: "Free readings are not configured for this deployment." },
          { status: 503 },
        ),
      );
    return noStore(
      NextResponse.json({ error: "A browser trial ID is required." }, { status: 422 }),
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertGuestTrialConfigured();
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "question" in body &&
      typeof body.question === "string"
    ) {
      const crisisSafety = classifyQuestion(body.question);
      if (crisisSafety.category === "selfHarmCrisis")
        return noStore(NextResponse.json({ safety: crisisSafety }, { status: 422 }));
    }
    const input = guestReadingInputSchema.parse(body);
    const marker = await markerState(request);
    if (marker.marker)
      return noStore(
        NextResponse.json(
          {
            error: marker.valid
              ? "This browser's free reading has already been used."
              : "This browser's trial marker could not be verified.",
            signupRequired: true,
          },
          { status: 409 },
        ),
      );
    const networkRateLimitKey = guestTrialNetworkRateLimitKey(clientRateLimitKey(request));
    if (networkRateLimitKey) await assertRateLimit(networkRateLimitKey, 30, 60 * 60 * 1_000);

    const question = input.question;
    const questionClassification = classifyQuestionContext(question, {
      topic: "general",
      horizon: "open",
      generalReading: false,
    });
    const safety = classifyQuestion(question);
    if (safety.interrupt) return noStore(NextResponse.json({ safety }, { status: 422 }));
    if (GUARDED_CATEGORIES.has(safety.category) && !input.continueAsReflection)
      return noStore(
        NextResponse.json({ safety, reflectionAcknowledgementRequired: true }, { status: 409 }),
      );

    const spread = spreads.find(({ id }) => id === input.spreadId);
    if (!spread)
      return noStore(
        NextResponse.json({ error: "That free spread is unavailable." }, { status: 404 }),
      );
    const relevantTraitStatements = await guestDateLensStatements(
      input.birthDate,
      question,
      questionClassification,
    );
    const draw = createLockedDraw({ cards: tarotCards, deckVersion: DECK_VERSION, spread });
    const generated = await new DeterministicFallbackProvider().generateWithProvenance({
      draw,
      question,
      questionClassification,
      relevantTraitStatements,
    });
    const createdAt = new Date().toISOString();
    const issued = issueGuestReadingReceipt(
      {
        readingId: draw.id,
        question,
        questionClassification,
        draw,
        result: generated.result,
        createdAt,
      },
      Date.parse(createdAt),
    );
    const receiptPayload = guestReceiptPayloadSchema.parse({
      version: "guest-reading-receipt-v1",
      readingId: draw.id,
      question,
      questionClassification,
      draw,
      result: generated.result,
      createdAt,
      expiresAt: issued.expiresAt,
    });
    const response = NextResponse.json(
      { reading: guestReadingDisplay(receiptPayload), receipt: issued.receipt },
      { status: 201 },
    );
    response.cookies.set(GUEST_TRIAL_COOKIE, issueGuestTrialMarker(marker.deviceId), {
      httpOnly: true,
      maxAge: GUEST_TRIAL_COOKIE_TTL_SECONDS,
      path: "/",
      sameSite: "strict",
      secure: process.env.APP_ENV !== "test",
    });
    return noStore(response);
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
          { error: "Free readings are not configured for this deployment." },
          { status: 503 },
        ),
      );
    if (error instanceof Error && error.message === "GUEST_DATE_LENS_UNAVAILABLE")
      return noStore(
        NextResponse.json(
          { error: "Birthday personalization is temporarily unavailable. Try again shortly." },
          { status: 503 },
        ),
      );
    if (error instanceof z.ZodError)
      return noStore(
        NextResponse.json(
          {
            error:
              "Choose a free spread, enter your birthday and question, and accept the guest terms.",
          },
          { status: 422 },
        ),
      );
    return noStore(
      NextResponse.json({ error: "The free reading could not be prepared." }, { status: 500 }),
    );
  }
}
