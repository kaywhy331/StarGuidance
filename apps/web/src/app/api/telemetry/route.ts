import { NextResponse } from "next/server";
import { z } from "zod";

import { productEventSchema, recordProductEvent } from "@/lib/product-telemetry";
import {
  assertRateLimit,
  assertSameOrigin,
  clientRateLimitKey,
  requestSecurityFailure,
} from "@/lib/request-security";

const browserEventNames = [
  "landing_view",
  "pricing_view",
  "signup_started",
  "profile_started",
  "shuffle_started",
  "card_revealed",
  "result_viewed",
  "reading_reopened",
  "report_previewed",
  "report_viewed",
  "outcome_invited",
] as const;

const browserEventSchema = productEventSchema.refine(
  ({ name }) => (browserEventNames as readonly string[]).includes(name),
  "This event is emitted only from a trusted server transition.",
);

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertRateLimit(`telemetry:${clientRateLimitKey(request)}`, 120, 60 * 60_000);
    const event = browserEventSchema.parse(await request.json());
    await recordProductEvent(event);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid product event." }, { status: 400 });
    return NextResponse.json({ error: "Product measurement is unavailable." }, { status: 503 });
  }
}
