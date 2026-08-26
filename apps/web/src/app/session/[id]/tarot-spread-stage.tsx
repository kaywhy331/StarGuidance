import type { CSSProperties } from "react";

import type { DealtCardView } from "./reading-types";
import { PhysicalTarotCard } from "./physical-tarot-card";

export function TarotSpreadStage({
  activeIndex,
  cards,
  dealing = false,
  focusMode,
  narratingIndexes = [],
  revealed,
  reducedMotion,
  onReveal,
  visibleCount = cards.length,
}: {
  activeIndex: number | null;
  cards: readonly DealtCardView[];
  dealing?: boolean;
  focusMode: "reveal" | "reading" | null;
  narratingIndexes?: readonly number[];
  revealed: ReadonlySet<number>;
  reducedMotion: boolean;
  /** Called with a card's index when the user intentionally reveals it
   * (click/tap/keyboard). Omit to render every card as a static, already-
   * settled view with no reveal affordance. */
  onReveal?: ((index: number) => void) | undefined;
  /** During the deal, cards mount one at a time while the grid retains the
   * final spread geometry. */
  visibleCount?: number;
}) {
  const activeCard = activeIndex === null ? undefined : cards[activeIndex];
  const narratingCards = narratingIndexes
    .map((index) => cards[index])
    .filter((card): card is DealtCardView => Boolean(card));
  const layout = cards[0]?.spreadLayout ?? {
    columns: Math.max(cards.length, 1),
    rows: 1,
    kind: "legacy",
  };
  const layoutStyle = {
    "--spread-columns": layout.columns,
    "--spread-rows": layout.rows,
  } as CSSProperties;
  return (
    <section
      aria-label="Your locked tarot spread"
      className={`tarot-spread-stage spread-count-${cards.length} ${dealing ? "is-dealing" : ""} ${
        activeCard ? "is-cinematic-review" : ""
      } ${focusMode === "reading" ? "is-reading-review" : ""}`}
      data-active-card-index={activeIndex ?? undefined}
      data-focus-mode={focusMode ?? undefined}
      data-layout-kind={layout.kind}
      data-testid="tarot-spread-stage"
      style={layoutStyle}
    >
      {cards.map((card, index) =>
        index < visibleCount ? (
          <PhysicalTarotCard
            card={card}
            focusMode={activeIndex === index ? focusMode : null}
            index={index}
            key={`${card.positionId}-${card.cardId}`}
            narrationActive={narratingIndexes.includes(index)}
            onReveal={onReveal && !revealed.has(index) ? () => onReveal(index) : undefined}
            reducedMotion={reducedMotion}
            revealed={revealed.has(index)}
          />
        ) : null,
      )}
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {activeCard
          ? `${focusMode === "reading" ? "Reviewing" : "Revealing"} ${activeCard.positionName}: ${activeCard.name}${
              activeCard.orientation === "reversed" ? ", reversed" : ""
            }.`
          : narratingCards.length > 0
            ? `Narration connecting ${narratingCards
                .map(({ name, positionName }) => `${positionName}: ${name}`)
                .join(", ")}.`
            : ""}
      </p>
    </section>
  );
}
