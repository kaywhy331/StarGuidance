import { NextResponse } from "next/server";
import {
  createInterpretationProvider,
  classifyQuestion,
  selectReadingLens,
} from "@starguidance/ai";
import { actorTransaction, reenqueueInterpretationJob } from "@starguidance/database";
import { spreads, tarotCards } from "@starguidance/tarot-content";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { runInterpretationJobs } from "@/lib/interpretation-worker";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { followUpLimit, followUpLimitMessage } from "@/lib/reading-policy";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter, getSystemDatabaseClient } from "@/lib/runtime";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("followUp"), question: z.string().trim().min(1).max(500) }),
]);

async function ownedReading(id: string) {
  const user = await requireUser();
  const persistence = persistenceFor(user);
  const reading = await persistence.repositories.readingSessions.get(user.id, id);
  return reading ? { persistence, reading, user } : undefined;
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owned = await ownedReading((await context.params).id);
    if (!owned) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    const { reading } = owned;
    const spread = spreads.find(({ id }) => id === reading.spreadId);
    const configuredFollowUpLimit = followUpLimit();
    const feedback = await owned.persistence.repositories.feedback.list(owned.user.id, reading.id);
    return NextResponse.json({
      reading: {
        id: reading.id,
        spreadId: reading.spreadId,
        // The immutable snapshot this reading was drawn against. Later profile
        // versions never move it, and a caller cannot otherwise tell which
        // version of themselves a past reading interpreted.
        profileSnapshotId: reading.profileSnapshotId,
        draw: reading.draw,
        cards: reading.draw.assignments.map((assignment) => {
          const card = tarotCards.find(({ id }) => id === assignment.cardId);
          const position = spread?.positions.find(({ id }) => id === assignment.positionId);
          if (!card) throw new Error("Locked draw references unavailable card content.");
          return {
            cardId: card.id,
            name: card.name,
            orientation: assignment.orientation,
            themes:
              assignment.orientation === "reversed" ? card.reversedThemes : card.uprightThemes,
            positionId: assignment.positionId,
            positionName: position?.displayName ?? assignment.positionId.replaceAll("-", " "),
            artwork: card.artwork,
          };
        }),
        result: reading.result,
        outputProvenance: reading.outputProvenance,
        generationStatus: reading.generationStatus,
        safetyClassification: reading.safetyClassification,
        followUps: reading.followUps.map(({ id, result }) => ({ id, result })),
        followUpLimit: configuredFollowUpLimit,
        followUpsRemaining: Math.max(0, configuredFollowUpLimit - reading.followUps.length),
        feedbackSubmitted: feedback.length > 0,
        createdAt: reading.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ error: "The reading could not be loaded." }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`reading-delete:${user.id}`, 20, 60 * 60 * 1000);
    const id = (await context.params).id;
    const persistence = persistenceFor(user);
    const deleted = await persistence.repositories.readingSessions.delete(user.id, id);
    if (!deleted) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    await recordAudit(user.id, "reading.deleted", "reading", id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ error: "The reading could not be deleted." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const owned = await ownedReading((await context.params).id);
    if (!owned) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    const { persistence, reading, user } = owned;
    await assertRateLimit(`reading-action:${reading.userId}`, 15);
    const input = actionSchema.parse(await request.json());
    const provider = createInterpretationProvider();
    const snapshot = (
      await persistence.repositories.profileSnapshots.get(user.id, reading.profileSnapshotId)
    )?.snapshot;
    if (input.action === "retry") {
      // The local runtime adapter has no interpretation_jobs table (see
      // apps/web/src/lib/repositories/local.ts) and never runs on Netlify,
      // so it keeps the original direct, synchronous retry.
      if (getRuntimeAdapter() !== "supabase") {
        const generated = await provider.generateWithProvenance({
          draw: reading.draw,
          question: persistence.decrypt(reading.encryptedQuestion, "reading-question"),
          relevantTraitStatements: snapshot
            ? reading.readingLens.traitIndexes.map(
                (index) => snapshot.traits[index]?.statement ?? "",
              )
            : [],
        });
        await persistence.repositories.outputs.save(
          user.id,
          reading.id,
          generated.result,
          generated.provenance,
        );
        await persistence.repositories.readingSessions.setGenerationStatus(
          user.id,
          reading.id,
          "ready",
        );
        await recordAudit(user.id, "reading.generation.retried", "reading", reading.id);
        return NextResponse.json({
          generationStatus: "ready",
          result: generated.result,
          draw: reading.draw,
        });
      }
      // Re-enqueues (reading.generationStatus back to a claimable job — see
      // reenqueueInterpretationJob's doc comment) then makes the same
      // best-effort inline attempt POST /api/readings makes on creation. If
      // it doesn't land immediately, the Netlify-scheduled sweep will.
      // Runs subject-bound (migration 0008): the user retrying can reset
      // exactly their own job row, the same RLS scope the original enqueue
      // had inside the reading's creating transaction.
      await actorTransaction(getSystemDatabaseClient(), user.id, (tx) =>
        reenqueueInterpretationJob(tx, reading.id),
      );
      try {
        await runInterpretationJobs(1);
      } catch {
        // Best-effort inline attempt; the durable job row survives regardless.
      }
      const current = await persistence.repositories.readingSessions.get(user.id, reading.id);
      await recordAudit(user.id, "reading.generation.retried", "reading", reading.id);
      return NextResponse.json({
        generationStatus: current?.generationStatus ?? "pending",
        result: current?.result,
        draw: reading.draw,
      });
    }
    const configuredFollowUpLimit = followUpLimit();
    if (reading.followUps.length >= configuredFollowUpLimit)
      return NextResponse.json(
        { error: followUpLimitMessage(configuredFollowUpLimit) },
        { status: 409 },
      );
    if (!reading.result)
      return NextResponse.json(
        { error: "The original reading must be complete before asking a follow-up." },
        { status: 409 },
      );
    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return NextResponse.json({ safety }, { status: 422 });
    const lens = selectReadingLens(input.question, snapshot?.traits ?? []);
    const result = await provider.generateFollowUp({
      draw: reading.draw,
      question: input.question,
      relevantTraitStatements: lens.statements,
      originalResult: reading.result,
    });
    const followUp = {
      id: crypto.randomUUID(),
      encryptedQuestion: persistence.encrypt(input.question, "follow-up-question"),
      result,
      createdAt: new Date().toISOString(),
    };
    await persistence.repositories.followUps.create(user.id, reading.id, followUp, {
      limit: configuredFollowUpLimit,
    });
    await recordAudit(user.id, "reading.follow_up.created", "reading", reading.id);
    return NextResponse.json(
      { followUp: { id: followUp.id, result }, draw: reading.draw },
      { status: 201 },
    );
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof Error && error.message === "FOLLOW_UP_LIMIT_REACHED")
      return NextResponse.json({ error: followUpLimitMessage(followUpLimit()) }, { status: 409 });
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json(
      { error: status === 401 ? "Authentication required." : "Invalid follow-up." },
      { status },
    );
  }
}
