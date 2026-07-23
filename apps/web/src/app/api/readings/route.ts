import { NextResponse } from "next/server";
import {
  classifyQuestion,
  DeterministicFallbackProvider,
  selectReadingLens,
} from "@starguidance/ai";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  decryptLocal,
  encryptLocal,
  localStore,
  recordAudit,
  type StoredReading,
} from "@/lib/local-store";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";

const inputSchema = z.object({
  spreadId: z.string().min(1),
  question: z.string().trim().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    assertSameOrigin(request);
    assertRateLimit(`reading:${user.id}`, 12);
    if (!user.profile)
      return NextResponse.json({ error: "Complete a private profile first." }, { status: 409 });
    const input = inputSchema.parse(await request.json());
    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return NextResponse.json({ safety }, { status: 422 });
    const spread = spreads.find(({ id }) => id === input.spreadId);
    if (!spread) return NextResponse.json({ error: "Unknown spread." }, { status: 404 });

    const readingLens = selectReadingLens(input.question, user.profile.snapshot.traits);
    const draw = createLockedDraw({
      cards: tarotCards,
      deckVersion: DECK_VERSION,
      spread,
    });
    const reading: StoredReading = {
      id: draw.id,
      userId: user.id,
      profileSnapshotId: user.profile.snapshot.id,
      readingLens: {
        version: readingLens.version,
        traitIndexes: readingLens.traitIndexes,
      },
      spreadId: spread.id,
      encryptedQuestion: encryptLocal(input.question),
      draw,
      generationStatus: "pending",
      followUps: [],
      createdAt: new Date().toISOString(),
    };
    localStore.readings.set(reading.id, reading);
    recordAudit("reading.draw.locked", user.id, reading.id);
    try {
      if (
        process.env.APP_ENV === "test" &&
        request.headers.get("x-e2e-force-generation-failure") === "1"
      )
        throw new Error("TEST_GENERATION_FAILURE");
      reading.result = await new DeterministicFallbackProvider().generate({
        draw,
        question: input.question,
        relevantTraitStatements: readingLens.statements,
      });
      reading.generationStatus = "ready";
    } catch {
      reading.generationStatus = "failed";
    }
    return NextResponse.json(
      { readingId: reading.id, safety, generationStatus: reading.generationStatus },
      { status: 201 },
    );
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json(
      { error: status === 401 ? "Authentication required." : "Invalid reading request." },
      { status },
    );
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const readings = [...localStore.readings.values()]
      .filter(({ userId }) => userId === user.id)
      .map(({ id, spreadId, encryptedQuestion, draw, generationStatus, createdAt }) => {
        const question = decryptLocal(encryptedQuestion);
        return {
          id,
          spreadId,
          questionPreview: `${question.slice(0, 48)}${question.length > 48 ? "…" : ""}`,
          draw,
          generationStatus,
          createdAt,
        };
      });
    return NextResponse.json({ readings });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
