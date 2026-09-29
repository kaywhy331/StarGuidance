import { NextResponse } from "next/server";
import {
  cardRevealLine,
  createInterpretationProvider,
  classifyFollowUpScope,
  classifyQuestion,
  readingLensStatements,
} from "@starguidance/ai";
import { actorTransaction, reenqueueInterpretationJob } from "@starguidance/database";
import { ritualProgressSchema } from "@starguidance/contracts";
import { findSpread, tarotCards } from "@starguidance/tarot-content";
import { z } from "zod";
import { assertCurrentPolicyConsents, POLICY_RECONSENT_REQUIRED, requireUser } from "@/lib/auth";
import { runInterpretationJobs } from "@/lib/interpretation-worker";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import {
  parseRelatedPersonReadingLens,
  relatedPersonProviderContext,
} from "@/lib/related-person-lens";
import { tryRecordProductEvent } from "@/lib/product-telemetry";
import { ritualSessionExpired } from "@/lib/ritual-progress";
import { followUpLimit, followUpLimitMessage } from "@/lib/reading-policy";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter, getSystemDatabaseClient } from "@/lib/runtime";
import { getRuntimeConfiguration, interpretationRuntimeOptions } from "@/lib/runtime-configuration";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({ action: z.literal("followUp"), question: z.string().trim().min(1).max(500) }),
  z.object({
    action: z.literal("progress"),
    phase: z.enum([
      "drawLocked",
      "dealing",
      "awaitingReveal",
      "revealing",
      "fullSpreadReady",
      "interpretationStreaming",
      "followUpAvailable",
      "complete",
    ]),
    cutIndex: z.number().int().min(0).max(77),
    revealedIndexes: z.array(z.number().int().nonnegative()).max(10),
  }),
]);

const ritualPhaseRank = {
  drawLocked: 0,
  dealing: 1,
  awaitingReveal: 2,
  revealing: 3,
  fullSpreadReady: 4,
  interpretationStreaming: 5,
  followUpAvailable: 6,
  complete: 7,
} as const;

async function ownedReading(id: string) {
  const user = await requireUser();
  const persistence = persistenceFor(user);
  const reading = await persistence.repositories.readingSessions.get(user.id, id);
  return reading ? { persistence, reading, user } : undefined;
}

function storedRelatedPersonContext(
  persistence: ReturnType<typeof persistenceFor>,
  encryptedLens: string | undefined,
) {
  return encryptedLens
    ? relatedPersonProviderContext(
        parseRelatedPersonReadingLens(
          persistence.decrypt(encryptedLens, "related-person-reading-lens"),
        ),
      )
    : [];
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owned = await ownedReading((await context.params).id);
    if (!owned) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    const { reading } = owned;
    const spread = findSpread(reading.spreadId, reading.draw.spreadVersion);
    const positions = reading.configuration.positions;
    const runtimeConfiguration = await getRuntimeConfiguration();
    const configuredFollowUpLimit = followUpLimit(runtimeConfiguration.commerce);
    const [feedback, storedProfile] = await Promise.all([
      owned.persistence.repositories.feedback.list(owned.user.id, reading.id),
      owned.persistence.repositories.profileSnapshots.get(owned.user.id, reading.profileSnapshotId),
    ]);
    const snapshot = storedProfile?.snapshot;
    const lensTraits = (snapshot?.traits ?? []).filter((_, index) =>
      reading.readingLens.traitIndexes.includes(index),
    );
    return NextResponse.json(
      {
        reading: {
          id: reading.id,
          // Return the private question only to its authenticated owner and only
          // in the no-store reading response. It is used for the pre-reveal
          // reflection and never written to a URL, log, or analytics payload.
          question: owned.persistence.decrypt(reading.encryptedQuestion, "reading-question"),
          spreadId: reading.spreadId,
          spreadName: spread?.name,
          // The immutable snapshot this reading was drawn against. Later profile
          // versions never move it, and a caller cannot otherwise tell which
          // version of themselves a past reading interpreted.
          profileSnapshotId: reading.profileSnapshotId,
          configuration: reading.configuration,
          personalization:
            reading.configuration.personalizationMode === "personalized_tarot" && snapshot
              ? {
                  lensVersion: reading.readingLens.version,
                  snapshotVersion: snapshot.version,
                  completeness: snapshot.completeness,
                  traits: lensTraits.map((trait) => ({
                    domain: trait.domain,
                    sourceSystem: trait.sourceSystem,
                    stability: trait.stability,
                    confidence: trait.confidence,
                    calculationVersion: trait.calculationVersion,
                  })),
                  tensionCount: reading.readingLens.tensionIndexes?.length ?? 0,
                  rawBirthDataSharedWithNarrator: false as const,
                }
              : undefined,
          draw: reading.draw,
          cards: reading.draw.assignments.map((assignment) => {
            const card = tarotCards.find(({ id }) => id === assignment.cardId);
            const position = positions?.find(({ id }) => id === assignment.positionId);
            if (!card) throw new Error("Locked draw references unavailable card content.");
            const themes =
              assignment.orientation === "reversed" ? card.reversedThemes : card.uprightThemes;
            const positionName =
              position?.displayName ?? assignment.positionId.replaceAll("-", " ");
            return {
              cardId: card.id,
              name: card.name,
              orientation: assignment.orientation,
              themes,
              baselineMeaning: cardRevealLine(card, assignment.orientation, positionName),
              positionId: assignment.positionId,
              positionName,
              positionDescription:
                position?.description ?? "How this card meets the focus of your reading.",
              placement: position?.placement ?? {
                column: assignment.order,
                row: 0,
                rotation: 0,
                layer: 0,
              },
              spreadLayout: spread?.layout ?? {
                columns: reading.draw.assignments.length,
                rows: 1,
                kind: "legacy",
              },
              artwork: card.artwork,
            };
          }),
          result:
            reading.ritualProgress &&
            ritualPhaseRank[reading.ritualProgress.phase] >= ritualPhaseRank.fullSpreadReady &&
            reading.ritualProgress.revealedIndexes.length === reading.draw.assignments.length
              ? reading.result
              : undefined,
          outputProvenance: reading.outputProvenance,
          generationStatus: reading.generationStatus,
          questionClassification: reading.questionClassification,
          entitlementDecision: reading.entitlementDecision,
          ritualProgress: reading.ritualProgress,
          expiresAt: reading.expiresAt,
          sessionExpired: ritualSessionExpired(reading),
          safetyClassification: reading.safetyClassification,
          // Like the main question, each follow-up question is returned only
          // to its owner in this no-store response so the reading can show
          // what was asked above what the cards answered.
          followUps: reading.followUps.map(({ id, result, encryptedQuestion }) => ({
            id,
            result,
            question: owned.persistence.decrypt(encryptedQuestion, "follow-up-question"),
          })),
          followUpLimit: configuredFollowUpLimit,
          followUpsRemaining: Math.max(0, configuredFollowUpLimit - reading.followUps.length),
          feedbackSubmitted: feedback.some(({ kind }) => kind === "experience"),
          outcomeFeedbackSubmitted: feedback.some(({ kind }) => kind === "outcome"),
          createdAt: reading.createdAt,
        },
      },
      { headers: { "cache-control": "private, no-store" } },
    );
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
  let activeFollowUpLimit: number | undefined;
  try {
    assertSameOrigin(request);
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "action" in body &&
      body.action === "followUp" &&
      "question" in body &&
      typeof body.question === "string"
    ) {
      const crisisSafety = classifyQuestion(body.question);
      if (crisisSafety.category === "selfHarmCrisis")
        return NextResponse.json({ safety: crisisSafety }, { status: 422 });
    }
    const owned = await ownedReading((await context.params).id);
    if (!owned) return NextResponse.json({ error: "Reading not found." }, { status: 404 });
    const { persistence, reading, user } = owned;
    assertCurrentPolicyConsents(user);
    // Ritual progress only records which already-locked cards the reader has
    // turned over. A ten-card spread writes a dozen of these in a minute, so
    // they get their own, looser bucket instead of exhausting the one that
    // guards AI generation (retry, follow-up). Both stay bounded.
    const progressWrite =
      typeof body === "object" && body !== null && "action" in body && body.action === "progress";
    await assertRateLimit(
      progressWrite ? `reading-progress:${reading.userId}` : `reading-action:${reading.userId}`,
      progressWrite ? 60 : 15,
    );
    const input = actionSchema.parse(body);
    if (input.action === "progress") {
      // No expiry check here on purpose: every reading in this table already
      // has its cards locked (createLocked), so revealing them after the
      // session window changes nothing about the draw. Refusing it only
      // stranded readers mid-reveal with no way to reach their interpretation.
      const revealedIndexes = [...new Set(input.revealedIndexes)].sort((a, b) => a - b);
      if (revealedIndexes.some((index) => index >= reading.draw.assignments.length))
        return NextResponse.json({ error: "Invalid ritual progress." }, { status: 422 });
      const previous = reading.ritualProgress;
      if (
        previous &&
        (previous.cutIndex !== input.cutIndex ||
          ritualPhaseRank[input.phase] < ritualPhaseRank[previous.phase] ||
          previous.revealedIndexes.some((index) => !revealedIndexes.includes(index)))
      )
        return NextResponse.json(
          { error: "This reading has already moved further along." },
          { status: 409 },
        );
      if (
        ["fullSpreadReady", "interpretationStreaming", "followUpAvailable", "complete"].includes(
          input.phase,
        ) &&
        revealedIndexes.length !== reading.draw.assignments.length
      )
        return NextResponse.json(
          { error: "Turn over every card before opening the whole reading." },
          { status: 422 },
        );
      const progress = ritualProgressSchema.parse({
        version: "ritual-progress-v2",
        phase: input.phase,
        cutIndex: input.cutIndex,
        revealedIndexes,
        updatedAt: new Date().toISOString(),
      });
      await persistence.repositories.readingSessions.updateRitualProgress(
        user.id,
        reading.id,
        progress,
      );
      return NextResponse.json({ progress });
    }
    if (input.action === "retry") {
      const runtimeConfiguration = await getRuntimeConfiguration();
      const provider = createInterpretationProvider(
        interpretationRuntimeOptions(runtimeConfiguration),
      );
      const snapshot = (
        await persistence.repositories.profileSnapshots.get(user.id, reading.profileSnapshotId)
      )?.snapshot;
      // The local runtime adapter has no interpretation_jobs table (see
      // apps/web/src/lib/repositories/local.ts) and never runs on Netlify,
      // so it keeps the original direct, synchronous retry.
      if (getRuntimeAdapter() !== "supabase") {
        const generated = await provider.generateWithProvenance({
          draw: reading.draw,
          configuration: reading.configuration,
          question: persistence.decrypt(reading.encryptedQuestion, "reading-question"),
          questionClassification: reading.questionClassification,
          relevantTraitStatements:
            reading.configuration.personalizationMode === "personalized_tarot" && snapshot
              ? readingLensStatements(reading.readingLens, snapshot.traits, snapshot.tensions)
              : [],
          relatedPersonContext: storedRelatedPersonContext(
            persistence,
            reading.encryptedRelatedPersonLens,
          ),
        });
        await persistence.repositories.outputs.save(user.id, reading.id, generated.result, {
          ...generated.provenance,
          contentVersion: runtimeConfiguration.content.tarotContentVersion,
          safetyPolicyVersion: runtimeConfiguration.prompts.safetyPolicyVersion,
        });
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
    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return NextResponse.json({ safety }, { status: 422 });
    const runtimeConfiguration = await getRuntimeConfiguration();
    const configuredFollowUpLimit = followUpLimit(runtimeConfiguration.commerce);
    activeFollowUpLimit = configuredFollowUpLimit;
    if (!reading.result)
      return NextResponse.json(
        { error: "Your reading is still being written. Ask a follow-up once it has arrived." },
        { status: 409 },
      );
    const fullSpreadReady =
      reading.ritualProgress !== undefined &&
      ["fullSpreadReady", "interpretationStreaming", "followUpAvailable", "complete"].includes(
        reading.ritualProgress.phase,
      ) &&
      reading.ritualProgress.revealedIndexes.length === reading.draw.assignments.length;
    if (!fullSpreadReady)
      return NextResponse.json(
        { error: "Turn over every card before asking a follow-up." },
        { status: 409 },
      );
    const originalQuestion = persistence.decrypt(reading.encryptedQuestion, "reading-question");
    const followUpScope = classifyFollowUpScope({
      originalQuestion,
      originalClassification: reading.questionClassification,
      followUpQuestion: input.question,
    });
    if (!followUpScope.sameReading)
      return NextResponse.json(
        {
          error:
            "That sounds like a new question — a different subject, person, or time frame. It deserves its own cards, so start a new reading for it.",
          newReadingRequired: true,
          reason: followUpScope.reason,
        },
        { status: 409 },
      );
    if (reading.followUps.length >= configuredFollowUpLimit)
      return NextResponse.json(
        { error: followUpLimitMessage(configuredFollowUpLimit) },
        { status: 409 },
      );
    const snapshot = (
      await persistence.repositories.profileSnapshots.get(user.id, reading.profileSnapshotId)
    )?.snapshot;
    const lensStatements =
      reading.configuration.personalizationMode === "personalized_tarot" && snapshot
        ? readingLensStatements(reading.readingLens, snapshot.traits, snapshot.tensions)
        : [];
    const provider = createInterpretationProvider(
      interpretationRuntimeOptions(runtimeConfiguration),
    );
    const generated = await provider.generateFollowUpWithProvenance({
      draw: reading.draw,
      configuration: reading.configuration,
      question: input.question,
      questionClassification: reading.questionClassification,
      relevantTraitStatements: lensStatements,
      relatedPersonContext: storedRelatedPersonContext(
        persistence,
        reading.encryptedRelatedPersonLens,
      ),
      originalResult: reading.result,
    });
    const result = generated.result;
    const followUp = {
      id: crypto.randomUUID(),
      encryptedQuestion: persistence.encrypt(input.question, "follow-up-question"),
      result,
      outputProvenance: {
        ...generated.provenance,
        contentVersion: runtimeConfiguration.content.tarotContentVersion,
        safetyPolicyVersion: runtimeConfiguration.prompts.safetyPolicyVersion,
      },
      createdAt: new Date().toISOString(),
    };
    await persistence.repositories.followUps.create(user.id, reading.id, followUp, {
      limit: configuredFollowUpLimit,
    });
    await recordAudit(user.id, "reading.follow_up.created", "reading", reading.id);
    await tryRecordProductEvent({
      idempotencyKey: `reading:${reading.id}:followup:${followUp.id}`,
      name: "followup_submitted",
      properties: { statusClass: "completed" },
    });
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
      return NextResponse.json(
        { error: followUpLimitMessage(activeFollowUpLimit ?? followUpLimit()) },
        { status: 409 },
      );
    if (error instanceof Error && error.message === POLICY_RECONSENT_REQUIRED)
      return NextResponse.json(
        { error: "Review the current service policies before continuing this reading." },
        { status: 428 },
      );
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 400;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "Authentication required."
            : "That request could not be completed. Please try again.",
      },
      { status },
    );
  }
}
