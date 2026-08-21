import "server-only";

import { createOracleStreamEvents } from "@starguidance/ai";
import { findSpread, resolveSpreadPositions, tarotCards } from "@starguidance/tarot-content";

import {
  guestReadingDisplaySchema,
  type GuestReadingDisplay,
  type GuestReceiptPayload,
} from "./guest-reading-contract";

export function guestReadingDisplay(payload: GuestReceiptPayload): GuestReadingDisplay {
  const spread = findSpread(payload.draw.spreadId);
  if (!spread) throw new Error("GUEST_READING_CONTENT_UNAVAILABLE");
  const positions = resolveSpreadPositions(spread, payload.questionClassification);
  return guestReadingDisplaySchema.parse({
    id: payload.readingId,
    spreadId: payload.draw.spreadId,
    draw: payload.draw,
    cards: payload.draw.assignments.map((assignment) => {
      const card = tarotCards.find(({ id }) => id === assignment.cardId);
      const position = positions.find(({ id }) => id === assignment.positionId);
      if (!card || !position) throw new Error("GUEST_READING_CONTENT_UNAVAILABLE");
      return {
        cardId: card.id,
        name: card.name,
        orientation: assignment.orientation,
        themes: assignment.orientation === "reversed" ? card.reversedThemes : card.uprightThemes,
        positionId: assignment.positionId,
        positionName: position.displayName,
        positionDescription: position.description,
        placement: position.placement,
        spreadLayout: spread.layout,
        artwork: card.artwork,
      };
    }),
    result: payload.result,
    previewEvents: createOracleStreamEvents(payload.result),
    questionClassification: payload.questionClassification,
    createdAt: payload.createdAt,
    receiptExpiresAt: payload.expiresAt,
  });
}
