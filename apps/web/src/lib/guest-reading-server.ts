import "server-only";

import {
  cardRevealLine,
  classifyFollowUpScope,
  classifyQuestion,
  createOracleStreamEvents,
  DeterministicFallbackProvider,
  FALLBACK_PROVIDER_ID,
  READING_RESULT_SCHEMA_VERSION,
} from "@starguidance/ai";
import type { FollowUpResult, ReadingOutputProvenance } from "@starguidance/contracts";
import type { StoredFollowUp, StoredReading } from "@starguidance/database";
import { findSpread, TAROT_CONTENT_VERSION, tarotCards } from "@starguidance/tarot-content";
import { finalizeCommittedDraw } from "@starguidance/tarot-domain";

import { readingConfiguration } from "./draw-ceremony";
import {
  guestReadingDisplaySchema,
  guestReceiptPayloadSchema,
  type GuestReadingDisplay,
  type GuestReceiptPayload,
} from "./guest-reading-contract";
import { guestDateLensStatements } from "./guest-date-lens";
import {
  GUEST_READING_RECEIPT_TTL_SECONDS,
  type GuestPrivateDrawCeremony,
  type GuestReadingHandoff,
  type GuestTrialMarkerDraw,
} from "./guest-reading-security";

export function guestReadingDisplay(
  payload: GuestReceiptPayload,
  options: { includeResult?: boolean } = {},
): GuestReadingDisplay {
  const spread = findSpread(payload.draw.spreadId, payload.draw.spreadVersion);
  if (!spread) throw new Error("GUEST_READING_CONTENT_UNAVAILABLE");
  const positions = payload.configuration.positions;
  return guestReadingDisplaySchema.parse({
    id: payload.readingId,
    spreadId: payload.draw.spreadId,
    question: payload.question,
    configuration: payload.configuration,
    draw: payload.draw,
    cards: payload.draw.assignments.map((assignment) => {
      const card = tarotCards.find(({ id }) => id === assignment.cardId);
      const position = positions.find(({ id }) => id === assignment.positionId);
      if (!card || !position) throw new Error("GUEST_READING_CONTENT_UNAVAILABLE");
      const themes =
        assignment.orientation === "reversed" ? card.reversedThemes : card.uprightThemes;
      return {
        cardId: card.id,
        name: card.name,
        orientation: assignment.orientation,
        themes,
        // The same card-specific line member readings use.
        baselineMeaning: cardRevealLine(card, assignment.orientation, position.displayName),
        positionId: assignment.positionId,
        positionName: position.displayName,
        positionDescription: position.description,
        placement: position.placement,
        spreadLayout: spread.layout,
        artwork: card.artwork,
      };
    }),
    ...(options.includeResult
      ? { result: payload.result, previewEvents: createOracleStreamEvents(payload.result) }
      : {}),
    questionClassification: payload.questionClassification,
    createdAt: payload.createdAt,
    receiptExpiresAt: payload.expiresAt,
  });
}

/**
 * Locks a guest ceremony into its receipt payload. Every input is explicit —
 * including `lockedAt` — so the same ceremony and the same recorded draw
 * inputs always reproduce the identical draw, lens and interpretation. That
 * determinism is what lets a repeated finalize (a lost response, a reload)
 * hand back the reading the browser already paid its free trial for.
 */
export async function lockGuestReceiptPayload(
  ceremony: GuestPrivateDrawCeremony,
  recorded: GuestTrialMarkerDraw,
): Promise<GuestReceiptPayload> {
  const spread = findSpread(ceremony.spread.id, ceremony.spread.version);
  if (!spread) throw new Error("GUEST_SPREAD_UNAVAILABLE");
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
    clientNonce: recorded.clientNonce,
    cutIndex: recorded.cutIndex,
    ...(recorded.selectedIndexes ? { selectedIndexes: recorded.selectedIndexes } : {}),
    reversalMode: ceremony.configuration.reversalMode,
    now: new Date(recorded.lockedAt),
  });
  const configuration = recorded.pureTarotFallback
    ? { ...ceremony.configuration, personalizationMode: "pure_tarot" as const }
    : ceremony.configuration;
  if (configuration.personalizationMode === "personalized_tarot" && !ceremony.birthDate)
    throw new Error("GUEST_DATE_LENS_UNAVAILABLE");
  const readerLens =
    configuration.personalizationMode === "personalized_tarot" && ceremony.birthDate
      ? await guestDateLensStatements(
          ceremony.birthDate,
          ceremony.question,
          ceremony.questionClassification,
        )
      : [];
  const generated = await new DeterministicFallbackProvider().generateWithProvenance({
    draw,
    configuration,
    question: ceremony.question,
    questionClassification: ceremony.questionClassification,
    relevantTraitStatements: readerLens,
  });
  return guestReceiptPayloadSchema.parse({
    version: "guest-reading-receipt-v2",
    readingId: draw.id,
    question: ceremony.question,
    questionClassification: ceremony.questionClassification,
    configuration,
    readerLens,
    draw,
    result: generated.result,
    provenance: { ...generated.provenance, contentVersion: TAROT_CONTENT_VERSION },
    createdAt: recorded.lockedAt,
    expiresAt: new Date(
      Date.parse(recorded.lockedAt) + GUEST_READING_RECEIPT_TTL_SECONDS * 1_000,
    ).toISOString(),
  });
}

/**
 * Rebuilds the full receipt payload from a compact email handoff. The cards
 * come straight from the handoff's locked draw; only the deterministic
 * interpretation text is regenerated.
 */
export async function receiptPayloadFromHandoff(
  handoff: GuestReadingHandoff,
): Promise<GuestReceiptPayload> {
  const spread = findSpread(handoff.draw.spreadId, handoff.draw.spreadVersion);
  if (!spread) throw new Error("GUEST_READING_CONTENT_UNAVAILABLE");
  const configuration = readingConfiguration({
    spread,
    reversalMode: handoff.reversalMode,
    personalizationMode: handoff.personalizationMode,
  });
  const generated = await new DeterministicFallbackProvider().generateWithProvenance({
    draw: handoff.draw,
    configuration,
    question: handoff.question,
    questionClassification: handoff.questionClassification,
    relevantTraitStatements: handoff.readerLens,
  });
  return guestReceiptPayloadSchema.parse({
    version: "guest-reading-receipt-v2",
    readingId: handoff.readingId,
    question: handoff.question,
    questionClassification: handoff.questionClassification,
    configuration,
    readerLens: handoff.readerLens,
    draw: handoff.draw,
    result: generated.result,
    provenance: { ...generated.provenance, contentVersion: TAROT_CONTENT_VERSION },
    createdAt: handoff.createdAt,
    expiresAt: handoff.expiresAt,
  });
}

export type GuestFollowUpOutcome =
  | { kind: "answered"; result: FollowUpResult; provenance: ReadingOutputProvenance }
  | { kind: "interrupted"; safety: ReturnType<typeof classifyQuestion> }
  | { kind: "newReadingRequired"; reason: ReturnType<typeof classifyFollowUpScope>["reason"] };

/**
 * Answers one follow-up from the receipt's exact cards with the deterministic
 * narrator. A question the safety policy interrupts, or one about a different
 * subject, gets no answer from these cards.
 */
export async function answerGuestFollowUp(
  receipt: GuestReceiptPayload,
  question: string,
): Promise<GuestFollowUpOutcome> {
  const safety = classifyQuestion(question);
  if (safety.interrupt) return { kind: "interrupted", safety };
  const scope = classifyFollowUpScope({
    originalQuestion: receipt.question,
    originalClassification: receipt.questionClassification,
    followUpQuestion: question,
  });
  if (!scope.sameReading) return { kind: "newReadingRequired", reason: scope.reason };
  const generated = await new DeterministicFallbackProvider().generateFollowUpWithProvenance({
    draw: receipt.draw,
    configuration: receipt.configuration,
    question,
    questionClassification: receipt.questionClassification,
    relevantTraitStatements: receipt.readerLens,
    originalResult: receipt.result,
  });
  return {
    kind: "answered",
    result: generated.result,
    provenance: { ...generated.provenance, contentVersion: TAROT_CONTENT_VERSION },
  };
}

/** One free reading maps to one history entry per account. */
export function guestReadingIdempotencyKey(guestReadingId: string): string {
  return `guest-trial:${guestReadingId}`;
}

/** Receipts issued before saving existed did not record their narrator
 * version; the guest lane only ever used the deterministic narrator. */
const UNRECORDED_GUEST_PROVENANCE: ReadingOutputProvenance = {
  providerId: FALLBACK_PROVIDER_ID,
  promptVersion: "legacy-unrecorded",
  schemaVersion: READING_RESULT_SCHEMA_VERSION,
  contentVersion: "legacy-unrecorded",
};

/**
 * The account-history copy of a verified guest reading: the same id, cards,
 * question, interpretation, and birthday lens, with every card already
 * revealed. It has no profile snapshot, server seed, or interpretation job,
 * and the guest trial — not the account allowance — granted it.
 */
export function storedGuestReading(input: {
  userId: string;
  receipt: GuestReceiptPayload;
  encryptedQuestion: string;
  safetyClassification: string;
  followUp?: StoredFollowUp | undefined;
  now?: Date;
}): StoredReading {
  const { receipt } = input;
  const now = (input.now ?? new Date()).toISOString();
  return {
    id: receipt.readingId,
    userId: input.userId,
    idempotencyKey: guestReadingIdempotencyKey(receipt.readingId),
    profileSnapshotId: null,
    source: "guest_trial",
    readingLens: {
      version: "guest-date-lens-v1",
      traitIndexes: [],
      statements: receipt.readerLens,
    },
    questionClassification: receipt.questionClassification,
    entitlementDecision: {
      version: "reading-entitlement-v1",
      mode: "guest-trial",
      outcome: "granted",
      entitlementClass: "standard",
      used: 0,
      limit: null,
      remaining: null,
      windowStartsAt: null,
      windowEndsAt: null,
    },
    ritualProgress: {
      version: "ritual-progress-v2",
      phase: "complete",
      cutIndex: receipt.draw.proof?.cutIndex ?? 0,
      revealedIndexes: receipt.draw.assignments.map((_, index) => index),
      updatedAt: now,
    },
    expiresAt: receipt.expiresAt,
    spreadId: receipt.draw.spreadId,
    configuration: receipt.configuration,
    encryptedQuestion: input.encryptedQuestion,
    safetyClassification: input.safetyClassification,
    draw: receipt.draw,
    result: receipt.result,
    outputProvenance: receipt.provenance ?? UNRECORDED_GUEST_PROVENANCE,
    generationStatus: "ready",
    followUps: input.followUp ? [input.followUp] : [],
    createdAt: receipt.createdAt,
  };
}
