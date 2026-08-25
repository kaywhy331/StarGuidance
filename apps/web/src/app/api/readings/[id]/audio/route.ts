import { createFollowUpStreamEvents, createOracleStreamEvents } from "@starguidance/ai";
import { followUpResultSchema, readingResultSchema } from "@starguidance/contracts";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createReadingAudioProvider, ReadingAudioProviderError } from "@/lib/reading-audio";
import { persistenceFor } from "@/lib/persistence";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const requestSchema = z
  .object({
    target: z.string().trim().min(1).max(100),
    sequence: z.number().int().min(0).max(23),
  })
  .strict();

function fullSpreadReady(reading: {
  ritualProgress?: { phase: string; revealedIndexes: readonly number[] };
  draw: { assignments: readonly unknown[] };
}): boolean {
  return (
    reading.ritualProgress !== undefined &&
    ["fullSpreadReady", "interpretationStreaming", "followUpAvailable", "complete"].includes(
      reading.ritualProgress.phase,
    ) &&
    reading.ritualProgress.revealedIndexes.length === reading.draw.assignments.length
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const input = requestSchema.parse(await request.json());
    const user = await requireUser();
    await assertRateLimit(`reading-audio:${user.id}`, 60, 60 * 60 * 1_000);

    const persistence = persistenceFor(user);
    const reading = await persistence.repositories.readingSessions.get(
      user.id,
      (await context.params).id,
    );
    if (!reading) return Response.json({ error: "Reading not found." }, { status: 404 });

    const primary = input.target === "primary";
    if (primary && !fullSpreadReady(reading))
      return Response.json(
        { error: "Reveal every card before requesting audio for the interpretation." },
        { status: 409 },
      );

    const result = primary
      ? reading.result
      : reading.followUps.find(({ id }) => id === input.target)?.result;
    if (!result)
      return Response.json(
        { error: "The persisted interpretation is not ready." },
        { status: 409 },
      );

    const events = primary
      ? createOracleStreamEvents(readingResultSchema.parse(result))
      : createFollowUpStreamEvents(followUpResultSchema.parse(result));
    const section = events.find(
      (event) => event.type === "phase" && event.sequence === input.sequence,
    );
    if (!section || section.type !== "phase")
      return Response.json({ error: "Reading section not found." }, { status: 404 });

    const provider = createReadingAudioProvider();
    const stream = await provider.stream(`${section.heading}. ${section.text}`, request.signal);
    return new Response(stream, {
      headers: {
        "cache-control": "private, no-store, no-transform",
        "content-type": "audio/mpeg",
        "x-accel-buffering": "no",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return Response.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof z.ZodError)
      return Response.json({ error: "Invalid audio section request." }, { status: 400 });
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return Response.json({ error: "Authentication required." }, { status: 401 });
    if (error instanceof ReadingAudioProviderError) {
      const disabled = error.code === "READING_AUDIO_DISABLED";
      return Response.json(
        {
          error: disabled
            ? "Audio readings are not available in this environment."
            : "The audio reading service is temporarily unavailable.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "The audio reading service is temporarily unavailable." },
      { status: 500 },
    );
  }
}
