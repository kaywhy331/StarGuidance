import { NextResponse } from "next/server";
import {
  classifyQuestion,
  classifyQuestionContext,
  createInterpretationProvider,
  GUARDED_CATEGORIES,
  recommendSpreadId,
  readingLensStatements,
  reviewTarotQuestion,
  selectReadingLens,
} from "@starguidance/ai";
import {
  birthProfileInputSchema,
  drawFinalizationInputSchema,
  GENERAL_READING_QUESTION,
  personalizationModeSchema,
  reversalModeSchema,
} from "@starguidance/contracts";
import { DECK_VERSION, findSpread, spreads, tarotCards } from "@starguidance/tarot-content";
import { finalizeCommittedDraw } from "@starguidance/tarot-domain";
import type { StoredReading } from "@starguidance/database";
import { z } from "zod";
import { assertCurrentPolicyConsents, POLICY_RECONSENT_REQUIRED, requireUser } from "@/lib/auth";
import { issueDrawCeremony, publicDrawCeremony, readDrawCeremony } from "@/lib/draw-ceremony";
import { runInterpretationJobs } from "@/lib/interpretation-worker";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import {
  buildRelatedPersonReadingLens,
  relatedPersonProviderContext,
} from "@/lib/related-person-lens";
import {
  classifyProductProvider,
  productModelVersion,
  productDurationBucket,
  tryRecordProductEvent,
} from "@/lib/product-telemetry";
import {
  findRetainedReading,
  readingEntitlementDecision,
  readingSessionTtlMs,
} from "@/lib/reading-policy";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter } from "@/lib/runtime";
import { getRuntimeConfiguration, interpretationRuntimeOptions } from "@/lib/runtime-configuration";

const prepareInputSchema = z
  .object({
    action: z.literal("prepare"),
    spreadId: z.string().min(1).optional(),
    question: z.string().trim().min(1).max(500),
    questionConfirmed: z.literal(true),
    reversalMode: reversalModeSchema.default("reversals_enabled"),
    personalizationMode: personalizationModeSchema.default("personalized_tarot"),
    continueAsReflection: z.boolean().optional().default(false),
  })
  .strict();
const idempotencyKeySchema = z.string().uuid();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "question" in body &&
      typeof body.question === "string"
    ) {
      const crisisSafety = classifyQuestion(body.question);
      if (crisisSafety.category === "selfHarmCrisis")
        return NextResponse.json({ safety: crisisSafety }, { status: 422 });
    }

    const user = await requireUser();
    assertCurrentPolicyConsents(user);
    await assertRateLimit(`reading:${user.id}`, 16);

    if (typeof body === "object" && body !== null && "action" in body && body.action === "review") {
      const input = z
        .object({ action: z.literal("review"), question: z.string().trim().min(1).max(500) })
        .strict()
        .parse(body);
      return NextResponse.json({
        question: input.question,
        review: reviewTarotQuestion(input.question),
        safety: classifyQuestion(input.question),
      });
    }

    const persistence = persistenceFor(user);
    const runtimeConfiguration = await getRuntimeConfiguration();

    if (
      typeof body === "object" &&
      body !== null &&
      "action" in body &&
      body.action === "prepare"
    ) {
      const input = prepareInputSchema.parse(body);
      const idempotencyKey = idempotencyKeySchema.parse(request.headers.get("idempotency-key"));
      const [profile, relationshipProfiles] = await Promise.all([
        persistence.repositories.birthProfiles.getActive(user.id),
        persistence.repositories.relationshipProfiles?.listActive(user.id) ?? Promise.resolve([]),
      ]);
      if (!profile)
        return NextResponse.json({ error: "Complete a private profile first." }, { status: 409 });

      const question = input.question;
      const questionClassification = classifyQuestionContext(question);
      const safety = classifyQuestion(question);
      if (safety.interrupt) return NextResponse.json({ safety }, { status: 422 });
      if (GUARDED_CATEGORIES.has(safety.category) && !input.continueAsReflection)
        return NextResponse.json(
          { safety, reflectionAcknowledgementRequired: true },
          { status: 409 },
        );
      const enabledSpreadIds = runtimeConfiguration.content.enabledSpreadIds;
      if (enabledSpreadIds.length === 0)
        return NextResponse.json(
          { error: "That spread is currently unavailable." },
          { status: 409 },
        );
      const selectedSpreadId = recommendSpreadId({
        question,
        classification: questionClassification,
        availableSpreadIds: enabledSpreadIds,
      });
      const spread = spreads.find(({ id }) => id === selectedSpreadId);
      if (!spread) return NextResponse.json({ error: "Unknown spread." }, { status: 404 });
      if (!runtimeConfiguration.content.enabledSpreadIds.includes(spread.id))
        return NextResponse.json(
          { error: "That spread is currently unavailable." },
          { status: 409 },
        );

      const previousReadings = await persistence.repositories.readingSessions.list(user.id);
      const idempotent = previousReadings.find(({ idempotencyKey: key }) => key === idempotencyKey);
      if (idempotent)
        return NextResponse.json({
          readingId: idempotent.id,
          generationStatus: idempotent.generationStatus,
          idempotentReplay: true,
        });
      const entitlementDecision = readingEntitlementDecision(
        previousReadings,
        Date.now(),
        runtimeConfiguration.commerce,
      );
      if (entitlementDecision.outcome === "limitReached")
        return NextResponse.json(
          {
            error: "Your included reading allowance is used for this window.",
            entitlementDecision,
          },
          { status: 429 },
        );
      const retained = findRetainedReading(
        previousReadings,
        question,
        (encrypted) => persistence.decrypt(encrypted, "reading-question"),
        runtimeConfiguration.commerce.rereadCooldownMinutes * 60_000,
      );
      if (retained)
        return NextResponse.json(
          {
            error:
              "You asked this recently. Keep the existing cards in view before starting another reading.",
            cooldownActive: true,
            retainedReadingId: retained.reading.id,
            availableAt: retained.availableAt,
          },
          { status: 409 },
        );

      const selectedLens =
        input.personalizationMode === "personalized_tarot"
          ? selectReadingLens(
              question,
              profile.snapshot.traits,
              profile.snapshot.tensions,
              questionClassification.topic,
            )
          : {
              version: "question-trait-lens-v2" as const,
              traitIndexes: [],
              tensionIndexes: [],
              statements: [],
            };
      const relatedPersonLens =
        input.personalizationMode === "personalized_tarot"
          ? buildRelatedPersonReadingLens(
              question,
              relationshipProfiles.map((relatedProfile) => ({
                profile: relatedProfile,
                input: birthProfileInputSchema.parse(
                  JSON.parse(
                    persistence.decrypt(
                      relatedProfile.encryptedInput,
                      "related-person-profile-input",
                    ),
                  ),
                ),
              })),
            )
          : undefined;
      const { ceremony } = issueDrawCeremony(persistence, {
        userId: user.id,
        idempotencyKey,
        deckVersion: DECK_VERSION,
        profileSnapshotId: profile.snapshot.id,
        readingLens: {
          version: selectedLens.version,
          traitIndexes: selectedLens.traitIndexes,
          tensionIndexes: selectedLens.tensionIndexes,
        },
        ...(relatedPersonLens ? { relatedPersonLens } : {}),
        question,
        questionClassification,
        entitlementDecision,
        safetyClassification: safety.category,
        continueAsReflection: input.continueAsReflection,
        spread,
        reversalMode: input.reversalMode,
        personalizationMode: input.personalizationMode,
      });
      await recordAudit(user.id, "reading.ritual.prepared", "reading", ceremony.sessionId);
      return NextResponse.json(
        {
          ceremony,
          questionReview: reviewTarotQuestion(question),
          questionClassification,
          safety,
          entitlementDecision,
        },
        { status: 201 },
      );
    }

    if (
      typeof body === "object" &&
      body !== null &&
      "action" in body &&
      body.action === "restore"
    ) {
      const input = z
        .object({ action: z.literal("restore"), ceremonyToken: z.string().min(32).max(65_536) })
        .strict()
        .parse(body);
      const privateCeremony = readDrawCeremony(persistence, input.ceremonyToken, user.id);
      const finalized = await persistence.repositories.readingSessions.get(
        user.id,
        privateCeremony.readingId,
      );
      return NextResponse.json(
        finalized
          ? {
              readingId: finalized.id,
              generationStatus: finalized.generationStatus,
              idempotentReplay: true,
            }
          : { ceremony: publicDrawCeremony(privateCeremony, input.ceremonyToken) },
      );
    }

    const input = drawFinalizationInputSchema.parse(body);
    const ceremony = readDrawCeremony(persistence, input.ceremonyToken, user.id);
    const alreadyFinalized = await persistence.repositories.readingSessions.get(
      user.id,
      ceremony.readingId,
    );
    if (alreadyFinalized)
      return NextResponse.json({
        readingId: alreadyFinalized.id,
        generationStatus: alreadyFinalized.generationStatus,
        idempotentReplay: true,
      });

    const spread = findSpread(ceremony.spread.id, ceremony.spread.version);
    if (!spread || ceremony.deckVersion !== DECK_VERSION)
      return NextResponse.json(
        { error: "The prepared deck or spread is no longer available. Start the ritual again." },
        { status: 409 },
      );
    if (!runtimeConfiguration.content.enabledSpreadIds.includes(spread.id))
      return NextResponse.json({ error: "That spread is currently unavailable." }, { status: 409 });

    const previousReadings = await persistence.repositories.readingSessions.list(user.id);
    const idempotent = previousReadings.find(
      ({ idempotencyKey }) => idempotencyKey === ceremony.idempotencyKey,
    );
    if (idempotent)
      return NextResponse.json({
        readingId: idempotent.id,
        generationStatus: idempotent.generationStatus,
        idempotentReplay: true,
      });
    const entitlementDecision = readingEntitlementDecision(
      previousReadings,
      Date.now(),
      runtimeConfiguration.commerce,
    );
    if (entitlementDecision.outcome === "limitReached")
      return NextResponse.json(
        { error: "Your included reading allowance is used for this window.", entitlementDecision },
        { status: 429 },
      );
    const retained = findRetainedReading(
      previousReadings,
      ceremony.question,
      (encrypted) => persistence.decrypt(encrypted, "reading-question"),
      runtimeConfiguration.commerce.rereadCooldownMinutes * 60_000,
    );
    if (retained)
      return NextResponse.json(
        {
          error:
            "You asked this recently. Keep the existing cards in view before starting another reading.",
          cooldownActive: true,
          retainedReadingId: retained.reading.id,
          availableAt: retained.availableAt,
        },
        { status: 409 },
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
    const now = new Date();
    const reading: StoredReading = {
      id: draw.id,
      userId: user.id,
      idempotencyKey: ceremony.idempotencyKey,
      profileSnapshotId: ceremony.profileSnapshotId,
      readingLens: ceremony.readingLens,
      questionClassification: ceremony.questionClassification,
      entitlementDecision,
      ritualProgress: {
        version: "ritual-progress-v2",
        phase: "drawLocked",
        cutIndex: input.cutIndex,
        revealedIndexes: [],
        updatedAt: now.toISOString(),
      },
      expiresAt: new Date(now.getTime() + readingSessionTtlMs()).toISOString(),
      spreadId: ceremony.spread.id,
      configuration: ceremony.configuration,
      encryptedQuestion: persistence.encrypt(ceremony.question, "reading-question"),
      ...(ceremony.relatedPersonLens
        ? {
            encryptedRelatedPersonLens: persistence.encrypt(
              JSON.stringify(ceremony.relatedPersonLens),
              "related-person-reading-lens",
            ),
          }
        : {}),
      encryptedServerSeed: persistence.encrypt(ceremony.serverSeed, "draw-server-seed"),
      safetyClassification: ceremony.safetyClassification,
      draw,
      generationStatus: "pending",
      followUps: [],
      createdAt: now.toISOString(),
    };
    const persisted = await persistence.repositories.readingSessions.createLocked(reading);
    if (persisted.id !== reading.id)
      return NextResponse.json({
        readingId: persisted.id,
        generationStatus: persisted.generationStatus,
        idempotentReplay: true,
      });

    await recordAudit(user.id, "reading.draw.locked", "reading", reading.id);
    await Promise.all([
      tryRecordProductEvent({
        idempotencyKey: `reading:${reading.id}:selected`,
        name: "reading_selected",
        properties: {
          spreadId: spread.id,
          spreadVersion: spread.version,
          cardCount: draw.assignments.length,
        },
      }),
      tryRecordProductEvent({
        idempotencyKey: `reading:${reading.id}:question`,
        name: "question_submitted",
        properties: {
          topic: ceremony.questionClassification.topic,
          horizon: ceremony.questionClassification.horizon,
          questionLength:
            ceremony.question === GENERAL_READING_QUESTION ? 0 : ceremony.question.length,
          generalReading: ceremony.questionClassification.generalReading,
        },
      }),
      tryRecordProductEvent({
        idempotencyKey: `reading:${reading.id}:draw`,
        name: "draw_locked",
        properties: {
          spreadId: spread.id,
          spreadVersion: spread.version,
          cardCount: draw.assignments.length,
        },
      }),
    ]);

    const snapshot = (
      await persistence.repositories.profileSnapshots.get(user.id, ceremony.profileSnapshotId)
    )?.snapshot;
    const relevantTraitStatements =
      ceremony.configuration.personalizationMode === "personalized_tarot" && snapshot
        ? readingLensStatements(ceremony.readingLens, snapshot.traits, snapshot.tensions)
        : [];
    if (
      process.env.APP_ENV === "test" &&
      request.headers.get("x-e2e-force-generation-failure") === "1"
    ) {
      await persistence.repositories.readingSessions.setGenerationStatus(
        user.id,
        reading.id,
        "failed",
      );
      reading.generationStatus = "failed";
      await tryRecordProductEvent({
        idempotencyKey: `reading:${reading.id}:generation-failed`,
        name: "generation_failed",
        properties: { errorClass: "unclassified", statusClass: "failed" },
      });
    } else if (getRuntimeAdapter() !== "supabase") {
      const generationStartedAt = Date.now();
      try {
        const generated = await createInterpretationProvider(
          interpretationRuntimeOptions(runtimeConfiguration),
        ).generateWithProvenance({
          draw,
          configuration: ceremony.configuration,
          question: ceremony.question,
          questionClassification: ceremony.questionClassification,
          relevantTraitStatements,
          relatedPersonContext: relatedPersonProviderContext(ceremony.relatedPersonLens),
        });
        await persistence.repositories.outputs.save(user.id, reading.id, generated.result, {
          ...generated.provenance,
          contentVersion: runtimeConfiguration.content.tarotContentVersion,
          safetyPolicyVersion: runtimeConfiguration.prompts.safetyPolicyVersion,
        });
        reading.generationStatus = "ready";
        const provider = classifyProductProvider(generated.provenance.providerId);
        await tryRecordProductEvent({
          idempotencyKey: `reading:${reading.id}:generation-completed`,
          name: "generation_completed",
          properties: {
            provider,
            modelVersion: productModelVersion(generated.provenance.providerId),
            generationMode: provider === "deterministic" ? "deterministic" : "live",
            fallbackUsed: provider === "deterministic",
            durationBucket: productDurationBucket(Date.now() - generationStartedAt),
            statusClass: "ready",
          },
        });
      } catch {
        reading.generationStatus = "failed";
        await persistence.repositories.readingSessions.setGenerationStatus(
          user.id,
          reading.id,
          "failed",
        );
        await tryRecordProductEvent({
          idempotencyKey: `reading:${reading.id}:generation-failed`,
          name: "generation_failed",
          properties: {
            errorClass: "unclassified",
            durationBucket: productDurationBucket(Date.now() - generationStartedAt),
            statusClass: "failed",
          },
        });
      }
    } else {
      try {
        await runInterpretationJobs(1);
      } catch {
        // The atomically enqueued job remains available to the scheduled worker.
      }
      const current = await persistence.repositories.readingSessions.get(user.id, reading.id);
      reading.generationStatus = current?.generationStatus ?? reading.generationStatus;
    }
    return NextResponse.json(
      {
        readingId: reading.id,
        drawProof: draw.proof,
        safety: classifyQuestion(ceremony.question),
        questionClassification: ceremony.questionClassification,
        entitlementDecision,
        generationStatus: reading.generationStatus,
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
    if (error instanceof Error && error.message === "READING_CONTENT_INACTIVE")
      return NextResponse.json(
        { error: "This deck or reading type is temporarily unavailable." },
        { status: 409 },
      );
    const status = error instanceof Error && error.message === "UNAUTHENTICATED" ? 401 : 400;
    if (error instanceof Error && error.message === POLICY_RECONSENT_REQUIRED)
      return NextResponse.json(
        { error: "Review the current service policies before starting a reading." },
        { status: 428 },
      );
    return NextResponse.json(
      { error: status === 401 ? "Authentication required." : "Invalid reading request." },
      { status },
    );
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const persistence = persistenceFor(user);
    const [storedReadings, reports, feedback] = await Promise.all([
      persistence.repositories.history.listReadings(user.id),
      persistence.repositories.reports.list(user.id),
      persistence.repositories.feedback.list(user.id),
    ]);
    const readings = storedReadings.map(
      ({ id, spreadId, encryptedQuestion, draw, generationStatus, createdAt }) => {
        const stored = storedReadings.find((reading) => reading.id === id)!;
        const question = persistence.decrypt(encryptedQuestion, "reading-question");
        const spread = findSpread(spreadId);
        const report = reports.find(
          (candidate) => candidate.snapshotId === stored.profileSnapshotId,
        );
        const artworkRouteVersion = draw.deckVersion.includes("v2") ? "v2" : "v3";
        return {
          id,
          spreadId,
          spreadName: spread?.name ?? spreadId.replaceAll("-", " "),
          questionPreview: `${question.slice(0, 48)}${question.length > 48 ? "…" : ""}`,
          cardCount: draw.assignments.length,
          cards: draw.assignments.map(({ cardId, orientation }) => ({
            cardId,
            orientation,
            artPath: `/art/tarot/${artworkRouteVersion}/${cardId}.svg`,
          })),
          resultTitle: stored.result
            ? `${stored.result.directAnswer.slice(0, 72)}${stored.result.directAnswer.length > 72 ? "…" : ""}`
            : undefined,
          generationStatus,
          followUpCount: stored.followUps.length,
          feedbackSubmitted: feedback.some(
            (entry) => entry.readingId === id && entry.kind === "experience",
          ),
          outcomeFeedbackSubmitted: feedback.some(
            (entry) => entry.readingId === id && entry.kind === "outcome",
          ),
          reportStatus: report?.status ?? "not-purchased",
          createdAt,
        };
      },
    );
    return NextResponse.json({ readings });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ error: "Reading history could not be loaded." }, { status: 500 });
  }
}
