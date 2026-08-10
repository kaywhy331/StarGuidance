import { NextResponse } from "next/server";
import {
  classifyQuestion,
  createInterpretationProvider,
  selectReadingLens,
} from "@starguidance/ai";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import type { StoredReading } from "@starguidance/database";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { runInterpretationJobs } from "@/lib/interpretation-worker";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { findRetainedReading } from "@/lib/reading-policy";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter } from "@/lib/runtime";

const inputSchema = z.object({
  spreadId: z.string().min(1),
  question: z.string().trim().min(1).max(500),
});
const idempotencyKeySchema = z.string().uuid();

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`reading:${user.id}`, 12);
    const idempotencyKey = idempotencyKeySchema.parse(request.headers.get("idempotency-key"));
    const persistence = persistenceFor(user);
    const profile = await persistence.repositories.birthProfiles.getActive(user.id);
    if (!profile)
      return NextResponse.json({ error: "Complete a private profile first." }, { status: 409 });
    const input = inputSchema.parse(await request.json());
    const safety = classifyQuestion(input.question);
    if (safety.interrupt) return NextResponse.json({ safety }, { status: 422 });
    const spread = spreads.find(({ id }) => id === input.spreadId);
    if (!spread) return NextResponse.json({ error: "Unknown spread." }, { status: 404 });

    const previousReadings = await persistence.repositories.readingSessions.list(user.id);
    const idempotent = previousReadings.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey,
    );
    if (idempotent)
      return NextResponse.json(
        {
          readingId: idempotent.id,
          safety,
          generationStatus: idempotent.generationStatus,
          idempotentReplay: true,
        },
        { status: 200 },
      );
    const retained = findRetainedReading(previousReadings, input.question, (encrypted) =>
      persistence.decrypt(encrypted, "reading-question"),
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

    const readingLens = selectReadingLens(input.question, profile.snapshot.traits);
    const draw = createLockedDraw({
      cards: tarotCards,
      deckVersion: DECK_VERSION,
      spread,
    });
    const reading: StoredReading = {
      id: draw.id,
      userId: user.id,
      idempotencyKey,
      profileSnapshotId: profile.snapshot.id,
      readingLens: {
        version: readingLens.version,
        traitIndexes: readingLens.traitIndexes,
      },
      spreadId: spread.id,
      encryptedQuestion: persistence.encrypt(input.question, "reading-question"),
      safetyClassification: safety.category,
      draw,
      generationStatus: "pending",
      followUps: [],
      createdAt: new Date().toISOString(),
    };
    const persisted = await persistence.repositories.readingSessions.createLocked(reading);
    if (persisted.id !== reading.id)
      return NextResponse.json(
        {
          readingId: persisted.id,
          safety,
          generationStatus: persisted.generationStatus,
          idempotentReplay: true,
        },
        { status: 200 },
      );
    await recordAudit(user.id, "reading.draw.locked", "reading", reading.id);
    if (
      process.env.APP_ENV === "test" &&
      request.headers.get("x-e2e-force-generation-failure") === "1"
    ) {
      // Synthetic-only: simulate a job that exhausted its retries, without
      // running the real provider or touching the job row, so nothing
      // reprocesses it later during the same test.
      await persistence.repositories.readingSessions.setGenerationStatus(
        user.id,
        reading.id,
        "failed",
      );
      reading.generationStatus = "failed";
    } else if (getRuntimeAdapter() !== "supabase") {
      // The local runtime adapter has no interpretation_jobs table (see
      // apps/web/src/lib/repositories/local.ts) and never runs on Netlify, so
      // it keeps generating synchronously exactly as before.
      try {
        const generated = await createInterpretationProvider().generateWithProvenance({
          draw,
          question: input.question,
          relevantTraitStatements: readingLens.statements,
        });
        await persistence.repositories.outputs.save(
          user.id,
          reading.id,
          generated.result,
          generated.provenance,
        );
        reading.generationStatus = "ready";
        await persistence.repositories.readingSessions.setGenerationStatus(
          user.id,
          reading.id,
          "ready",
        );
      } catch {
        reading.generationStatus = "failed";
        await persistence.repositories.readingSessions.setGenerationStatus(
          user.id,
          reading.id,
          "failed",
        );
      }
    } else {
      // createLocked already enqueued this reading's interpretation job in
      // the same transaction (see insertInterpretationJob). Draining it here
      // keeps today's near-synchronous latency in the common case; if this
      // attempt is interrupted or the provider fails transiently, the job
      // stays durably claimable and the Netlify-scheduled sweep
      // (/api/internal/interpretation-jobs) finishes it later — the
      // "survives serverless interruption" property docs/KNOWN-GAPS.md
      // called out.
      try {
        await runInterpretationJobs(1);
      } catch {
        // Best-effort inline attempt; the durable job row survives regardless.
      }
      const current = await persistence.repositories.readingSessions.get(user.id, reading.id);
      reading.generationStatus = current?.generationStatus ?? reading.generationStatus;
    }
    return NextResponse.json(
      { readingId: reading.id, safety, generationStatus: reading.generationStatus },
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
        const spread = spreads.find((candidate) => candidate.id === spreadId);
        const report = reports.find(
          (candidate) => candidate.snapshotId === stored.profileSnapshotId,
        );
        return {
          id,
          spreadId,
          spreadName: spread?.name ?? spreadId.replaceAll("-", " "),
          questionPreview: `${question.slice(0, 48)}${question.length > 48 ? "…" : ""}`,
          draw,
          generationStatus,
          followUpCount: stored.followUps.length,
          feedbackSubmitted: feedback.some((entry) => entry.readingId === id),
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
