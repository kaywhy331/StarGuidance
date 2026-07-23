import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createOracleStreamEvents } from "@starguidance/ai";
import { readingResultSchema } from "@starguidance/contracts";
import { spreads, tarotCards } from "@starguidance/tarot-content";

import { SanctuaryVisualPreview } from "./visual-preview";

export const metadata: Metadata = {
  title: "Sanctuary visual preview · StarGuidance",
  robots: { index: false, follow: false },
};

export default function VisualPreviewPage() {
  if (process.env.APP_ENV === "production") notFound();
  const spread = spreads.find(({ id }) => id === "direction")!;
  const selected = [tarotCards[2]!, tarotCards[10]!, tarotCards[17]!];
  const cards = selected.map((card, index) => ({
    cardId: card.id,
    name: card.name,
    orientation: index === 1 ? ("reversed" as const) : ("upright" as const),
    positionId: spread.positions[index]!.id,
    positionName: spread.positions[index]!.displayName,
    artwork: card.artwork,
  }));
  const result = readingResultSchema.parse({
    title: "The quiet architecture of change",
    directAnswer:
      "The locked spread invites a measured beginning: listen first, name the turning point, then act from renewed orientation.",
    centralTheme:
      "The High Priestess, Wheel of Fortune, and The Star form a passage from inward knowing through changing conditions toward renewed orientation.",
    cards: cards.map((card) => ({
      positionId: card.positionId,
      cardId: card.cardId,
      orientation: card.orientation,
      traditionalMeaning: `${card.name} opens an original symbolic view of this position.`,
      personalizedMeaning:
        "Notice what is stable in your own observed pattern before treating the image as guidance.",
      questionConnection: "Use the card as reflection, never as factual proof or fixed fate.",
    })),
    synthesis:
      "Together, the cards suggest making room for quieter evidence while conditions turn, preserving enough agency to choose a grounded next step.",
    likelyTrajectory: {
      summary:
        "If present conditions continue, the choice may clarify through observation rather than urgency.",
      conditions: ["New evidence remains visible", "The reader preserves room to revise"],
      alternateTrajectory:
        "A direct conversation or material change could reveal a more useful path than the current pattern.",
    },
    userAgency: [
      "Name one observable fact",
      "Choose a proportionate next action",
      "Leave room for new evidence",
    ],
    reflectionQuestion: "What becomes possible when you do not force certainty before listening?",
    disconfirmingEvidence: ["Behavior contradicts the pattern", "Conditions materially change"],
    uncertainty: "Tarot is reflective guidance, not factual proof or a guarantee of future events.",
    safetyFlags: [],
  });
  return (
    <SanctuaryVisualPreview
      cards={cards}
      events={createOracleStreamEvents(result).filter((event) => event.type === "phase")}
      result={result}
    />
  );
}
