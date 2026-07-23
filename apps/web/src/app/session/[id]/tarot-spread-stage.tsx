import type { DealtCardView } from "./reading-types";
import { PhysicalTarotCard } from "./physical-tarot-card";

export function TarotSpreadStage({
  cards,
  revealed,
  reducedMotion,
  onReveal,
}: {
  cards: readonly DealtCardView[];
  revealed: ReadonlySet<number>;
  reducedMotion: boolean;
  onReveal: (index: number) => void;
}) {
  return (
    <section
      aria-label="Your locked tarot spread"
      className={`tarot-spread-stage spread-count-${cards.length}`}
      data-testid="tarot-spread-stage"
    >
      {cards.map((card, index) => (
        <PhysicalTarotCard
          card={card}
          index={index}
          key={`${card.positionId}-${card.cardId}`}
          onReveal={() => onReveal(index)}
          reducedMotion={reducedMotion}
          revealed={revealed.has(index)}
        />
      ))}
    </section>
  );
}
