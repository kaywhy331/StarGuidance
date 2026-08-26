import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  classifyQuestion,
  classifyQuestionContext,
  DeterministicFallbackProvider,
  GUARDED_CATEGORIES,
  recommendSpreadId,
  reviewTarotQuestion,
} from "@starguidance/ai";
import { DECK_VERSION, findSpread, spreads, tarotCards } from "@starguidance/tarot-content";
import { finalizeCommittedDraw } from "@starguidance/tarot-domain";
import { z } from "zod";

import { readingConfiguration } from "@/lib/draw-ceremony";
import {
  FREE_GUEST_SPREAD_IDS,
  GUEST_DEVICE_HEADER,
  guestDeviceIdSchema,
  guestReadingActionSchema,
  guestReceiptPayloadSchema,
} from "@/lib/guest-reading-contract";
import {
  assertGuestTrialConfigured,
  GUEST_TRIAL_COOKIE,
  GUEST_TRIAL_COOKIE_TTL_SECONDS,
  GuestTrialConfigurationError,
  guestTrialNetworkRateLimitKey,
  issueGuestDrawCeremony,
  issueGuestReadingReceipt,
  issueGuestTrialMarker,
  publicGuestDrawCeremony,
  verifyGuestDrawCeremony,
  verifyGuestReadingReceipt,
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

async function markerState(request: Request) {
  const deviceId = guestDevice(request);
  const marker = (await cookies()).get(GUEST_TRIAL_COOKIE)?.value;
  return {
    deviceId,
    marker,
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
    const input = guestReadingActionSchema.parse(body);
    const marker = await markerState(request);

    if (input.action === "review") {
      if (marker.marker)
        return noStore(
          NextResponse.json(
            { error: "This browser's free reading has already been used.", signupRequired: true },
            { status: 409 },
          ),
        );
      return noStore(NextResponse.json({ review: reviewTarotQuestion(input.question) }));
    }

    if (input.action === "recover" || input.action === "reveal") {
      if (!marker.marker || !marker.valid)
        return noStore(
          NextResponse.json({ error: "The guest-reading marker is unavailable." }, { status: 410 }),
        );
      const receipt = verifyGuestReadingReceipt(input.receipt);
      if (!receipt)
        return noStore(
          NextResponse.json(
            { error: "This guest reading has expired or changed." },
            { status: 410 },
          ),
        );
      return noStore(
        NextResponse.json({
          reading: guestReadingDisplay(receipt, { includeResult: input.action === "reveal" }),
          receipt: input.receipt,
        }),
      );
    }

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

    if (input.action === "restore") {
      const ceremony = verifyGuestDrawCeremony(input.ceremonyToken, marker.deviceId);
      if (!ceremony)
        return noStore(
          NextResponse.json(
            { error: "The pending guest ritual expired or changed." },
            { status: 410 },
          ),
        );
      return noStore(
        NextResponse.json({ ceremony: publicGuestDrawCeremony(ceremony, input.ceremonyToken) }),
      );
    }

    if (input.action === "prepare") {
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
        birthDate: input.birthDate,
        question: input.question,
        questionClassification,
        configuration,
        spread,
      });
      return noStore(NextResponse.json({ ceremony, safety }, { status: 201 }));
    }

    const ceremony = verifyGuestDrawCeremony(input.ceremonyToken, marker.deviceId);
    if (!ceremony)
      return noStore(
        NextResponse.json(
          { error: "The pending guest ritual expired or changed." },
          { status: 410 },
        ),
      );
    const spread = findSpread(ceremony.spread.id, ceremony.spread.version);
    if (!spread || ceremony.deckVersion !== DECK_VERSION)
      return noStore(
        NextResponse.json(
          { error: "The prepared free spread is no longer available." },
          { status: 409 },
        ),
      );
    const lockedSpread = {
      ...spread,
      positions: ceremony.configuration.positions,
      capabilities: ceremony.configuration.capabilities,
    };
    const draw = finalizeCommittedDraw({
      cards: tarotCards,
      deckVersion: ceremony.deckVersion,
      spread: lockedSpread,
      sessionId: ceremony.readingId,
      serverSeed: ceremony.serverSeed,
      serverSeedCommitment: ceremony.serverSeedCommitment,
      clientNonce: input.clientNonce,
      cutIndex: input.cutIndex,
      ...(input.selectedIndexes ? { selectedIndexes: input.selectedIndexes } : {}),
      reversalMode: ceremony.configuration.reversalMode,
    });
    const relevantTraitStatements =
      ceremony.configuration.personalizationMode === "personalized_tarot"
        ? await guestDateLensStatements(
            ceremony.birthDate,
            ceremony.question,
            ceremony.questionClassification,
          )
        : [];
    const generated = await new DeterministicFallbackProvider().generateWithProvenance({
      draw,
      configuration: ceremony.configuration,
      question: ceremony.question,
      questionClassification: ceremony.questionClassification,
      relevantTraitStatements,
    });
    const createdAt = new Date().toISOString();
    const issued = issueGuestReadingReceipt(
      {
        readingId: draw.id,
        question: ceremony.question,
        questionClassification: ceremony.questionClassification,
        configuration: ceremony.configuration,
        readerLens: relevantTraitStatements,
        draw,
        result: generated.result,
        createdAt,
      },
      Date.parse(createdAt),
    );
    const receiptPayload = guestReceiptPayloadSchema.parse({
      version: "guest-reading-receipt-v2",
      readingId: draw.id,
      question: ceremony.question,
      questionClassification: ceremony.questionClassification,
      configuration: ceremony.configuration,
      readerLens: relevantTraitStatements,
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
          { error: "Birthday personalization is temporarily unavailable." },
          { status: 503 },
        ),
      );
    if (error instanceof z.ZodError)
      return noStore(
        NextResponse.json({ error: "The free-reading request is invalid." }, { status: 422 }),
      );
    return noStore(
      NextResponse.json({ error: "The free reading could not be prepared." }, { status: 500 }),
    );
  }
}
