import "server-only";

import {
  cardRevealLine,
  createOracleStreamEvents,
  DeterministicFallbackProvider,
} from "@starguidance/ai";
import { findSpread, tarotCards } from "@starguidance/tarot-content";
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
    createdAt: handoff.createdAt,
    expiresAt: handoff.expiresAt,
  });
}
