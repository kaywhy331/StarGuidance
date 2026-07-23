import { NextResponse } from "next/server";
import {
  DeterministicFallbackProvider,
  classifyQuestion,
  selectReadingLens,
} from "@starguidance/ai";
import { spreads, tarotCards } from "@starguidance/tarot-content";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { decryptLocal, encryptLocal, localStore, recordAudit } from "@/lib/local-store";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-security";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("followUp"), question: z.string().trim().min(1).max(500) }),
]);

async function ownedReading(id: string) {
  const user = await requireUser();
  const reading = localStore.readings.get(id);
  return reading?.userId === user.id ? reading : undefined;
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const reading = await ownedReading((await context.params).id);
    if (!reading) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    const spread = spreads.find(({ id }) => id === reading.spreadId);
    return NextResponse.json({
      reading: {
        id: reading.id,
        spreadId: reading.spreadId,
        draw: reading.draw,
        cards: reading.draw.assignments.map((assignment) => {
          const card = tarotCards.find(({ id }) => id === assignment.cardId);
          const position = spread?.positions.find(({ id }) => id === assignment.positionId);
          if (!card) throw new Error("Locked draw references unavailable card content.");
          return {
            cardId: card.id,
            name: card.name,
            orientation: assignment.orientation,
            positionId: assignment.positionId,
            positionName: position?.displayName ?? assignment.positionId.replaceAll("-", " "),
            artwork: card.artwork,
          };
        }),
        result: reading.result,
        generationStatus: reading.generationStatus,
        followUps: reading.followUps.map(({ id, result }) => ({ id, result })),
        createdAt: reading.createdAt,
      },
    });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const reading = await ownedReading((await context.params).id);
    if (!reading) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    assertRateLimit(`reading-action:${reading.userId}`, 15);
    const input = actionSchema.parse(await request.json());
    const provider = new DeterministicFallbackProvider();
    const snapshot = localStore.profileSnapshots.get(reading.profileSnapshotId)?.snapshot;
    if (input.action === "retry") {
      reading.result = await provider.generate({
        draw: reading.draw,
        question: decryptLocal(reading.encryptedQuestion),
        relevantTraitStatements: snapshot
          ? reading.readingLens.traitIndexes.map((index) => snapshot.traits[index]?.statement ?? "")
          : [],
      });
      reading.generationStatus = "ready";
      recordAudit("reading.generation.retried", reading.userId, reading.id);
      return NextResponse.json({ result: reading.result, draw: reading.draw });
    }
    if (reading.followUps.length >= 1)
      return NextResponse.json(
        {
          error:
            "This MVP includes one follow-up per reading. Keep the same cards in view and allow time for reflection.",
        },
        { status: 409 },
      );
    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return NextResponse.json({ safety }, { status: 422 });
    const lens = selectReadingLens(input.question, snapshot?.traits ?? []);
    const result = await provider.generate({
      draw: reading.draw,
      question: input.question,
      relevantTraitStatements: lens.statements,
    });
    const followUp = {
      id: crypto.randomUUID(),
      encryptedQuestion: encryptLocal(input.question),
      result,
    };
    reading.followUps.push(followUp);
    recordAudit("reading.follow_up.created", reading.userId, reading.id);
    return NextResponse.json(
      { followUp: { id: followUp.id, result }, draw: reading.draw },
      { status: 201 },
    );
  } catch (error) {
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json(
      { error: status === 401 ? "Authentication required." : "Invalid follow-up." },
      { status },
    );
  }
}
