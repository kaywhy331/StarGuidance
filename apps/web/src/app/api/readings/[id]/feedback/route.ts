import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";

const feedbackSchema = z
  .object({
    resonance: z.number().int().min(1).max(5).optional(),
    helpfulness: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().min(1).max(1_000).optional(),
  })
  .refine(
    ({ resonance, helpfulness, comment }) =>
      resonance !== undefined || helpfulness !== undefined || comment !== undefined,
    { message: "At least one feedback field is required." },
  );

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
      ...(input.resonance === undefined ? {} : { resonance: input.resonance }),
      ...(input.helpfulness === undefined ? {} : { helpfulness: input.helpfulness }),
      ...(input.comment === undefined
        ? {}
        : { encryptedComment: persistence.encrypt(input.comment, "feedback-comment") }),
    });
    await recordAudit(user.id, "reading.feedback.created", "reading", readingId);

    return NextResponse.json(
      {
        feedback: {
          id: feedback.id,
          resonance: feedback.resonance,
          helpfulness: feedback.helpfulness,
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
