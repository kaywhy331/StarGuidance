import type { DealtCardView } from "./reading-types";
import { PhysicalTarotCard } from "./physical-tarot-card";

export function TarotSpreadStage({
  activeIndex,
  cards,
  focusMode,
  revealed,
  reducedMotion,
  onReveal,
}: {
  activeIndex: number | null;
  cards: readonly DealtCardView[];
  focusMode: "reveal" | "reading" | null;
  revealed: ReadonlySet<number>;
  reducedMotion: boolean;
  /** Called with a card's index when the user intentionally reveals it
   * (click/tap/keyboard). Omit to render every card as a static, already-
   * settled view with no reveal affordance. */
  onReveal?: ((index: number) => void) | undefined;
}) {
  const activeCard = activeIndex === null ? undefined : cards[activeIndex];
  return (
    <section
      aria-label="Your locked tarot spread"
      className={`tarot-spread-stage spread-count-${cards.length} ${
        activeCard ? "is-cinematic-review" : ""
      } ${focusMode === "reading" ? "is-reading-review" : ""}`}
      data-active-card-index={activeIndex ?? undefined}
      data-focus-mode={focusMode ?? undefined}
      data-testid="tarot-spread-stage"
    >
      {cards.map((card, index) => (
        <PhysicalTarotCard
          card={card}
          focusMode={activeIndex === index ? focusMode : null}
          index={index}
          key={`${card.positionId}-${card.cardId}`}
          onReveal={onReveal && !revealed.has(index) ? () => onReveal(index) : undefined}
          reducedMotion={reducedMotion}
          revealed={revealed.has(index)}
        />
      ))}
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {activeCard
          ? `${focusMode === "reading" ? "Reviewing" : "Revealing"} ${activeCard.positionName}: ${activeCard.name}${
              activeCard.orientation === "reversed" ? ", reversed" : ""
            }.`
          : ""}
      </p>
    </section>
  );
}
