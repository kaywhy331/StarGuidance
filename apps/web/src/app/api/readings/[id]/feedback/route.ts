import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { tryRecordProductEvent } from "@/lib/product-telemetry";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

const experienceFeedbackSchema = z
  .object({
    kind: z.literal("experience"),
    resonance: z.number().int().min(1).max(5).optional(),
    helpfulness: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().min(1).max(1_000).optional(),
  })
  .refine(
    ({ resonance, helpfulness, comment }) =>
      resonance !== undefined || helpfulness !== undefined || comment !== undefined,
    { message: "At least one feedback field is required." },
  );

const outcomeFeedbackSchema = z.object({
  kind: z.literal("outcome"),
  outcomeStatus: z.enum(["occurred", "partial", "did_not_occur", "unclear"]),
  behaviorChanged: z.boolean(),
  comment: z.string().trim().min(1).max(1_000).optional(),
});

const feedbackSchema = z.union([experienceFeedbackSchema, outcomeFeedbackSchema]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`reading-feedback:${user.id}`, 20, 60 * 60 * 1_000);
    const readingId = (await context.params).id;
    const persistence = persistenceFor(user);
    const reading = await persistence.repositories.readingSessions.get(user.id, readingId);
    if (!reading) return NextResponse.json({ error: "Reading not found." }, { status: 404 });

    const input = feedbackSchema.parse(await request.json());
    const feedback = await persistence.repositories.feedback.create({
      userId: user.id,
      readingId,
      kind: input.kind,
      ...(input.kind !== "outcome" ? {} : { outcomeStatus: input.outcomeStatus }),
      ...(input.kind !== "outcome" ? {} : { behaviorChanged: input.behaviorChanged }),
      ...(input.kind !== "experience" || input.resonance === undefined
        ? {}
        : { resonance: input.resonance }),
      ...(input.kind !== "experience" || input.helpfulness === undefined
        ? {}
        : { helpfulness: input.helpfulness }),
      ...(input.comment === undefined
        ? {}
        : { encryptedComment: persistence.encrypt(input.comment, "feedback-comment") }),
    });
    await recordAudit(user.id, "reading.feedback.created", "reading", readingId);
    await tryRecordProductEvent({
      idempotencyKey: `reading:${readingId}:feedback:${feedback.id}`,
      name: feedback.kind === "outcome" ? "outcome_submitted" : "feedback_submitted",
      properties: {
        feedbackKind: feedback.kind,
        ...(feedback.outcomeStatus ? { outcomeStatus: feedback.outcomeStatus } : {}),
        ...(feedback.behaviorChanged === undefined
          ? {}
          : { behaviorChanged: feedback.behaviorChanged }),
        ...(feedback.kind !== "experience"
          ? {}
          : {
              ratingBand:
                Math.max(feedback.helpfulness ?? 0, feedback.resonance ?? 0) >= 4
                  ? "high"
                  : Math.max(feedback.helpfulness ?? 0, feedback.resonance ?? 0) >= 2
                    ? "mid"
                    : "low",
            }),
      },
    });

    return NextResponse.json(
      {
        feedback: {
          id: feedback.id,
          kind: feedback.kind,
          resonance: feedback.resonance,
          helpfulness: feedback.helpfulness,
          outcomeStatus: feedback.outcomeStatus,
          behaviorChanged: feedback.behaviorChanged,
          createdAt: feedback.createdAt,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: "Invalid feedback." }, { status: 400 });
    return NextResponse.json({ error: "Feedback could not be saved." }, { status: 500 });
  }
}
