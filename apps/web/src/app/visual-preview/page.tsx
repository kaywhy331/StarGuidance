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
      "A careful change is already taking shape. Do not force certainty; choose the next step you can test and revise.",
    overallPattern:
      "The spread moves from inner knowledge, through uncertainty, toward a clearer direction.",
    cards: cards.map((card, index) => ({
      positionId: card.positionId,
      positionLabel: card.positionName,
      cardId: card.cardId,
      orientation: card.orientation,
      coreMeaning: `${card.name} carries ${card.themes.slice(0, 2).join(" and ")}.`,
      positionInterpretation: [
        "You already recognize the change beneath the surface, even before every consequence is visible.",
        "Waiting for perfect certainty could become its own decision. Notice what fear keeps postponing.",
        "One measured step will show more than another round of analysis. Let reality answer you.",
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
      "Your intuition is meeting a real-world shift. The way through is a deliberate move that tests the direction without pretending uncertainty has vanished.",
    likelyTrajectory:
      "If this pattern continues, a practical conversation or reversible decision will make the stronger route easier to see.",
    alternatePath: null,
    timing: null,
    userAgency:
      "Name one observable fact, take one proportionate action, and leave room to revise it.",
    reflectionPrompt: "What becomes possible when you do not force certainty before listening?",
    uncertaintyNote:
      "This is a conditional reading; new evidence and choices can change the direction.",
    personalizationLens: null,
    safetyFlags: [],
  });
  const events = createOracleStreamEvents(result).filter((event) => event.type === "phase");
  return <SanctuaryVisualPreview cards={cards} events={events} result={result} />;
}
