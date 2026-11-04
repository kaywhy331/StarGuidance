import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  classifyQuestion,
  classifyQuestionContext,
  GUARDED_CATEGORIES,
  recommendSpreadId,
  reviewTarotQuestion,
} from "@starguidance/ai";
import { DECK_VERSION, findSpread, spreads } from "@starguidance/tarot-content";
import { z } from "zod";

import { readingConfiguration } from "@/lib/draw-ceremony";
import {
  FREE_GUEST_SPREAD_IDS,
  GUEST_DEVICE_HEADER,
  guestDeviceIdSchema,
  guestReadingActionSchema,
  type GuestReceiptPayload,
} from "@/lib/guest-reading-contract";
import {
  assertGuestTrialConfigured,
  GUEST_TRIAL_COOKIE,
  GUEST_TRIAL_COOKIE_TTL_SECONDS,
  GuestTrialConfigurationError,
  guestTrialNetworkRateLimitKey,
  issueGuestDrawCeremony,
  issueGuestReadingHandoff,
  issueGuestReadingReceipt,
  issueGuestTrialMarker,
  publicGuestDrawCeremony,
  readGuestTrialMarker,
  verifyGuestDrawCeremony,
  verifyGuestReadingReceipt,
  type GuestTrialMarkerDraw,
} from "@/lib/guest-reading-security";
import { guestReadingDisplay, lockGuestReceiptPayload } from "@/lib/guest-reading-server";
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

async function markerState(request: Request) {
  const deviceId = guestDevice(request);
  const marker = (await cookies()).get(GUEST_TRIAL_COOKIE)?.value;
  const payload = readGuestTrialMarker(marker, deviceId);
  return { deviceId, marker, payload, valid: payload !== undefined };
}

const ceremonyExpiredMessage =
  "This shuffle rested too long and has closed. Let’s begin again with fresh cards.";
const spreadChangedMessage =
  "This spread changed since you began. Let’s begin again with fresh cards.";

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
          { error: "Free readings aren’t available here right now." },
          { status: 503 },
        ),
      );
    return noStore(
      NextResponse.json({ error: "Please refresh the page and try again." }, { status: 422 }),
    );
  }
}

function lockedResponse(
  payload: GuestReceiptPayload,
  options: { status: number; replayed?: boolean; personalizationFallback?: boolean },
): NextResponse {
  const issued = issueGuestReadingReceipt(payload, Date.parse(payload.createdAt));
  return NextResponse.json(
    {
      reading: guestReadingDisplay(payload),
      receipt: issued.receipt,
      handoff: issueGuestReadingHandoff(payload),
      ...(options.replayed ? { replayed: true } : {}),
      ...(options.personalizationFallback ? { personalizationFallback: true } : {}),
    },
    { status: options.status },
  );
}

const alreadyUsedMessage = "You’ve had your free reading in this browser.";

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
    const input = guestReadingActionSchema.parse(body);
    const marker = await markerState(request);

    if (input.action === "review") {
      if (marker.marker)
        return noStore(
          NextResponse.json({ error: alreadyUsedMessage, signupRequired: true }, { status: 409 }),
        );
      return noStore(NextResponse.json({ review: reviewTarotQuestion(input.question) }));
    }

    if (input.action === "recover" || input.action === "reveal") {
      if (!marker.marker || !marker.valid)
        return noStore(
          NextResponse.json(
            { error: "We couldn’t find your free reading in this browser." },
            { status: 410 },
          ),
        );
      const receipt = verifyGuestReadingReceipt(input.receipt);
      if (!receipt)
        return noStore(
          NextResponse.json(
            { error: "Your saved guest reading expired after 7 days." },
            { status: 410 },
          ),
        );
      return noStore(
        NextResponse.json({
          reading: guestReadingDisplay(receipt, { includeResult: input.action === "reveal" }),
          receipt: input.receipt,
          handoff: issueGuestReadingHandoff(receipt),
        }),
      );
    }

    // A browser whose marker already records this exact ceremony gets that
    // same locked draw back — from restore or from a repeated finalize — so a
    // lost finalize response never costs the free reading, and a second
    // finalize with a different nonce can never re-roll the cards.
    if ((input.action === "restore" || input.action === "finalize") && marker.payload?.draw) {
      const ceremony = verifyGuestDrawCeremony(input.ceremonyToken, marker.deviceId);
      if (ceremony && marker.payload.draw.ceremonyId === ceremony.readingId) {
        if (ceremony.deckVersion !== DECK_VERSION)
          return noStore(NextResponse.json({ error: spreadChangedMessage }, { status: 409 }));
        const payload = await lockGuestReceiptPayload(ceremony, marker.payload.draw);
        return noStore(
          lockedResponse(payload, {
            status: 200,
            replayed: true,
            personalizationFallback: marker.payload.draw.pureTarotFallback === true,
          }),
        );
      }
    }

    if (marker.marker)
      return noStore(
        NextResponse.json(
          {
            error: marker.valid
              ? alreadyUsedMessage
              : "We couldn’t confirm this browser’s free reading.",
            signupRequired: true,
          },
          { status: 409 },
        ),
      );
    const networkRateLimitKey = guestTrialNetworkRateLimitKey(clientRateLimitKey(request));
    if (networkRateLimitKey) await assertRateLimit(networkRateLimitKey, 30, 60 * 60 * 1_000);

    if (input.action === "restore") {
      const ceremony = verifyGuestDrawCeremony(input.ceremonyToken, marker.deviceId);
      if (!ceremony)
        return noStore(NextResponse.json({ error: ceremonyExpiredMessage }, { status: 410 }));
      return noStore(
        NextResponse.json({ ceremony: publicGuestDrawCeremony(ceremony, input.ceremonyToken) }),
      );
    }

    if (input.action === "prepare") {
      if (input.personalizationMode === "personalized_tarot" && !input.birthDate)
        return noStore(
          NextResponse.json(
            { error: "Add your birthday, or turn off birthday personalization." },
            { status: 422 },
          ),
        );
      const questionClassification = classifyQuestionContext(input.question);
      const safety = classifyQuestion(input.question);
      if (safety.interrupt) return noStore(NextResponse.json({ safety }, { status: 422 }));
      if (GUARDED_CATEGORIES.has(safety.category) && !input.continueAsReflection)
        return noStore(
          NextResponse.json({ safety, reflectionAcknowledgementRequired: true }, { status: 409 }),
        );
      const selectedSpreadId = recommendSpreadId({
        question: input.question,
        classification: questionClassification,
        availableSpreadIds: FREE_GUEST_SPREAD_IDS,
      });
      const spread = spreads.find(({ id }) => id === selectedSpreadId);
      if (!spread)
        return noStore(
          NextResponse.json({ error: "That free spread is unavailable." }, { status: 404 }),
        );
      const configuration = readingConfiguration({
        spread,
        reversalMode: input.reversalMode,
        personalizationMode: input.personalizationMode,
      });
      const { ceremony } = issueGuestDrawCeremony({
        deviceId: marker.deviceId,
        deckVersion: DECK_VERSION,
        birthDate: input.personalizationMode === "personalized_tarot" ? input.birthDate : undefined,
        question: input.question,
        questionClassification,
        configuration,
        spread,
      });
      return noStore(NextResponse.json({ ceremony, safety }, { status: 201 }));
    }

    const ceremony = verifyGuestDrawCeremony(input.ceremonyToken, marker.deviceId);
    if (!ceremony)
      return noStore(NextResponse.json({ error: ceremonyExpiredMessage }, { status: 410 }));
    const spread = findSpread(ceremony.spread.id, ceremony.spread.version);
    if (!spread || ceremony.deckVersion !== DECK_VERSION)
      return noStore(NextResponse.json({ error: spreadChangedMessage }, { status: 409 }));
    const recorded: GuestTrialMarkerDraw = {
      ceremonyId: ceremony.readingId,
      clientNonce: input.clientNonce,
      cutIndex: input.cutIndex,
      ...(input.selectedIndexes ? { selectedIndexes: [...input.selectedIndexes] } : {}),
      lockedAt: new Date().toISOString(),
      ...(input.pureTarotFallback &&
      ceremony.configuration.personalizationMode === "personalized_tarot"
        ? { pureTarotFallback: true }
        : {}),
    };
    const receiptPayload = await lockGuestReceiptPayload(ceremony, recorded);
    const response = lockedResponse(receiptPayload, {
      status: 201,
      personalizationFallback: recorded.pureTarotFallback === true,
    });
    response.cookies.set(
      GUEST_TRIAL_COOKIE,
      issueGuestTrialMarker(marker.deviceId, Date.now(), recorded),
      {
        httpOnly: true,
        maxAge: GUEST_TRIAL_COOKIE_TTL_SECONDS,
        path: "/",
        sameSite: "strict",
        secure: process.env.APP_ENV !== "test",
      },
    );
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
          { error: "Free readings aren’t available here right now." },
          { status: 503 },
        ),
      );
    if (error instanceof Error && error.message === "GUEST_DATE_LENS_UNAVAILABLE")
      return noStore(
        NextResponse.json(
          {
            error: "Birthday personalization is temporarily unavailable.",
            birthdayLensUnavailable: true,
          },
          { status: 503 },
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
        { error: "The cards couldn’t be laid out just now. Please try again." },
        { status: 500 },
      ),
    );
  }
}
