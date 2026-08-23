import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createOracleStreamEvents } from "@starguidance/ai";
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
  const cards = selected.map((card, index) => {
    const position = positions[index]!;
    const orientation = index === 1 ? ("reversed" as const) : ("upright" as const);
    const themes = orientation === "reversed" ? card.reversedThemes : card.uprightThemes;
    return {
      cardId: card.id,
      name: card.name,
      orientation,
      themes,
      baselineMeaning:
        orientation === "reversed"
          ? `In ${position.displayName}, ${card.name} reversed may show a ${card.reversalFacets?.[0] ?? "blocked"} expression of ${themes.slice(0, 2).join(" and ")}.`
          : `In ${position.displayName}, ${card.name} highlights ${themes.slice(0, 2).join(" and ")}.`,
      positionId: position.id,
      positionName: position.displayName,
      positionDescription: position.description,
      placement: position.placement,
      spreadLayout: spread.layout,
      artwork: card.artwork,
    };
  });
  const result = readingResultSchema.parse({
    schemaVersion: "reading-result-v3",
    directAnswer:
      "The quiet architecture of change is already forming: movement becomes useful when it is measured, observable, and open to revision.",
    overallPattern:
      "The spread moves from inner knowledge through changing conditions toward renewed orientation. The tension is not whether change exists, but how consciously it is met.",
    cards: cards.map((card, index) => ({
      positionId: card.positionId,
      positionLabel: card.positionName,
      cardId: card.cardId,
      orientation: card.orientation,
      coreMeaning: `${card.name} carries ${card.themes.slice(0, 2).join(" and ")}.`,
      positionInterpretation: [
        "In Situation, quiet inner knowing suggests that the reader already recognizes the essential change, even before all of its consequences are visible.",
        "In Challenge, changing conditions can feel delayed or internalized; waiting for perfect certainty could become its own decision.",
        "In Direction, renewed orientation supports one measured step that can be tested against real evidence.",
      ][index]!,
      relationshipNotes: [
        `${cards[0]!.name} in Situation develops in sequence with ${cards[1]!.name} in Challenge and ${cards[2]!.name} in Direction.`,
      ],
      supportingEvidence: [
        `${card.name}: approved ${card.orientation} themes — ${card.themes.join(", ")}.`,
        `${card.positionName}: ${positions[index]!.interpretiveFunction}.`,
      ],
    })),
    synthesis:
      "Taken together, the cards describe an intuitive recognition meeting a real-world shift and becoming a deliberate next move. The Direction card matters because it turns uncertainty into something testable without pretending uncertainty has vanished.",
    likelyTrajectory:
      "Under present conditions, following Direction suggests a clearer and more hopeful route—one that becomes visible through a practical conversation, invitation, or reversible decision.",
    alternatePath: null,
    timing: null,
    userAgency:
      "Name one observable fact, choose a proportionate next action, and leave enough room to revise it when the situation answers back.",
    reflectionPrompt: "What becomes possible when you do not force certainty before listening?",
    uncertaintyNote:
      "Tarot is reflective guidance, not factual proof or a guarantee; new evidence and choices can change the pattern.",
    personalizationLens: null,
    safetyFlags: [],
  });
  const events = createOracleStreamEvents(result).filter((event) => event.type === "phase");
  return <SanctuaryVisualPreview cards={cards} events={events} result={result} />;
}
