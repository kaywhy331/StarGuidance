import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createFollowUpStreamEvents, createOracleStreamEvents } from "@starguidance/ai";
import { readingResultSchema } from "@starguidance/contracts";
import { resolveSpreadPositions, spreads, tarotCards } from "@starguidance/tarot-content";

import { SanctuaryVisualPreview } from "./visual-preview";

export const metadata: Metadata = {
  title: "Sanctuary visual preview · StarGuidance",
  robots: { index: false, follow: false },
};

export default function VisualPreviewPage() {
  const previewEnabled =
    process.env.APP_ENV !== "production" || process.env.ENABLE_VISUAL_PREVIEW === "true";
  if (!previewEnabled) notFound();
  const spread = spreads.find(({ id }) => id === "three-card")!;
  const positions = resolveSpreadPositions(spread, {
    topic: "change",
    intent: "planning",
    generalReading: false,
  });
  const selected = [tarotCards[2]!, tarotCards[10]!, tarotCards[17]!];
  const cards = selected.map((card, index) => ({
    cardId: card.id,
    name: card.name,
    orientation: index === 1 ? ("reversed" as const) : ("upright" as const),
    themes: index === 1 ? card.reversedThemes : card.uprightThemes,
    positionId: positions[index]!.id,
    positionName: positions[index]!.displayName,
    placement: positions[index]!.placement,
    spreadLayout: spread.layout,
    artwork: card.artwork,
  }));
  const result = readingResultSchema.parse({
    schemaVersion: "reading-result-v2",
    title: "The quiet architecture of change",
    passages: [
      {
        id: "opening",
        role: "opening",
        text: "It feels like the quieter part of you already knows this change can't be forced. The next movement is going to come from recognizing the right moment, not manufacturing one.",
        cardReferences: [cards[0]!.positionId],
      },
      {
        id: "thread-1",
        role: "underlyingPattern",
        text: "Your history with this seems to have taught you to listen before you move. That instinct is useful now, although waiting too long could become its own kind of decision.",
        cardReferences: [cards[0]!.positionId],
      },
      {
        id: "thread-2",
        role: "underlyingPattern",
        text: "You may soon notice the conditions around you shifting before your own certainty catches up. I wouldn't be surprised if a conversation or practical invitation makes the choice feel more real.",
        cardReferences: [cards[1]!.positionId],
      },
      {
        id: "thread-3",
        role: "development",
        text: "What comes next has a clearer quality to it. The hope here isn't blind optimism; it's the feeling of finally seeing enough of the road to take a measured step.",
        cardReferences: [cards[2]!.positionId],
      },
      {
        id: "turning",
        role: "turningPoint",
        text: "The turning point may come when waiting starts costing more than one measured step forward. That is where renewed orientation stops being an idea and becomes a decision.",
        cardReferences: [cards[2]!.positionId],
      },
      {
        id: "likely",
        role: "trajectory",
        text: "If the present pattern continues, this feels like it's leading toward a clearer and more hopeful direction—one you can test in the real world without demanding certainty first.",
        cardReferences: [cards[2]!.positionId],
      },
      {
        id: "alternate",
        role: "alternative",
        text: "A sudden change in circumstances could open another route. If that happens, follow what becomes observable rather than the path you had already imagined.",
        cardReferences: [cards[1]!.positionId],
      },
      {
        id: "agency",
        role: "agency",
        text: "Your part is to name one observable fact, choose a proportionate next action, and leave enough room to revise it when the situation answers back.",
        cardReferences: [cards[2]!.positionId],
      },
      {
        id: "closing",
        role: "closing",
        text: "This doesn't feel like the end of the uncertainty. It feels like the moment when uncertainty stops preventing movement.",
        cardReferences: [cards[2]!.positionId],
      },
    ],
    cards: cards.map((card, index) => ({
      positionId: card.positionId,
      cardId: card.cardId,
      orientation: card.orientation,
      passageIds: [
        `thread-${index + 1}`,
        ...(index === 0 ? ["opening"] : []),
        ...(index === 1 ? ["alternate"] : []),
        ...(index === 2 ? ["turning", "likely", "agency", "closing"] : []),
      ],
    })),
    trajectory: {
      likelyPassageId: "likely",
      conditions: ["New evidence remains visible", "The reader preserves room to revise"],
      alternatePassageId: "alternate",
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
  const events = [
    ...createOracleStreamEvents(result),
    ...createFollowUpStreamEvents({
      response:
        "Looking again at The Star in Direction, your pattern of leaving room for new evidence supports the original reading: choose one grounded next step without forcing certainty.",
    }),
  ].filter((event) => event.type === "phase");
  return <SanctuaryVisualPreview cards={cards} events={events} result={result} />;
}
