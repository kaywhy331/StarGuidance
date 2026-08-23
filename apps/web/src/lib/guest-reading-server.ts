import "server-only";

import { createOracleStreamEvents } from "@starguidance/ai";
import { findSpread, tarotCards } from "@starguidance/tarot-content";

import {
  guestReadingDisplaySchema,
  type GuestReadingDisplay,
  type GuestReceiptPayload,
} from "./guest-reading-contract";

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
        baselineMeaning:
          assignment.orientation === "reversed"
            ? `In ${position.displayName}, ${card.name} reversed may show a ${card.reversalFacets?.[0] ?? "blocked or internalized"} expression of ${themes.slice(0, 2).join(" and ")}.`
            : `In ${position.displayName}, ${card.name} highlights ${themes.slice(0, 2).join(" and ")}.`,
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
