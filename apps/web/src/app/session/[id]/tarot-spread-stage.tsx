"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { DealtCardView } from "./reading-types";
import type { CasinoPickTarget } from "./shuffle-shells";
import { PhysicalTarotCard, type DealOrigin } from "./physical-tarot-card";
import { useStageFlip, type CardHandoffOrigin } from "./stage-flip";

/** Without a handoff the deal begins at the center of the spread, faded out,
 * so a recovered ritual still reads as cards arriving in their positions. */
function centeredDealOrigin(card: DealtCardView): DealOrigin {
  return {
    x: `${((card.spreadLayout.columns - 1) / 2 - card.placement.column) * 6.5}rem`,
    y: `${((card.spreadLayout.rows - 1) / 2 - card.placement.row) * 8.5}rem`,
    scale: 0.94,
    opacity: 0,
  };
}

/** Viewport-space box of one spread slot in the dealt layout. */
export interface SpreadSlot {
  readonly positionId: string;
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

/** An invisible copy of the dealt spread's grid, using the same classes and
 * stage geometry, so the fan can send each picked card to the exact slot it
 * will occupy once dealt. Re-measures whenever the viewport changes. */
export function SpreadSlotGhost({
  layout,
  onMeasure,
  positions,
}: {
  layout: { columns: number; rows: number; kind: string };
  onMeasure: (slots: readonly SpreadSlot[]) => void;
  positions: readonly CasinoPickTarget[];
}) {
  const stageRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const figures = stage.querySelectorAll<HTMLElement>(".physical-card-figure");
      onMeasure(
        positions.map((position, index) => {
          const rect = figures[index]?.getBoundingClientRect() ?? new DOMRect();
          return {
            positionId: position.id,
            centerX: rect.left + rect.width / 2,
            centerY: rect.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
          };
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [onMeasure, positions]);
  const layoutStyle = {
    "--spread-columns": layout.columns,
    "--spread-rows": layout.rows,
  } as CSSProperties;
  return (
    <section aria-hidden="true" className="sanctuary-stage is-dealing spread-slot-ghost">
      <div className="ritual-card-layout">
        <section
          className={`tarot-spread-stage spread-count-${positions.length} is-dealing`}
          data-layout-kind={layout.kind}
          ref={stageRef}
          style={layoutStyle}
        >
          {positions.map((position) => (
            <figure
              className="physical-card-figure"
              key={position.id}
              style={
                {
                  "--spread-column": position.placement.column + 1,
                  "--spread-row": position.placement.row + 1,
                  "--spread-rotation": `${position.placement.rotation}deg`,
                  "--spread-layer": position.placement.layer,
                } as CSSProperties
              }
            >
              <span className="physical-tarot-card" />
            </figure>
          ))}
        </section>
        <p className="ritual-deal-status">{"\u200b"}</p>
      </div>
    </section>
  );
}

export function TarotSpreadStage({
  activeIndex,
  cards,
  dealing = false,
  focusMode,
  handoff,
  layoutKey = "",
  narratingIndexes = [],
  revealed,
  reducedMotion,
  onReveal,
  settledCount = cards.length,
}: {
  activeIndex: number | null;
  cards: readonly DealtCardView[];
  /** While dealing, every card is mounted: cards below `settledCount` rest in
   * their slots; the rest hold at their deal origin, face down. */
  dealing?: boolean;
  focusMode: "reveal" | "reading" | null;
  /** Where the reader last saw each position's card (the picked shells of the
   * fan). Each physical card first appears exactly there, then travels to its
   * slot, so the chosen cards and the dealt cards are visibly the same. */
  handoff?: readonly CardHandoffOrigin[] | undefined;
  /** Changes whenever the surrounding layout changes phase. The whole spread
   * glides between layouts instead of jumping. */
  layoutKey?: string;
  narratingIndexes?: readonly number[];
  revealed: ReadonlySet<number>;
  reducedMotion: boolean;
  /** Called with a card's index when the user intentionally reveals it
   * (click/tap/keyboard). Omit to render every card as a static, already-
   * settled view with no reveal affordance. */
  onReveal?: ((index: number) => void) | undefined;
  settledCount?: number;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const figureRefs = useRef<(HTMLElement | null)[]>([]);
  const [measured, setMeasured] = useState<{
    handoff: readonly CardHandoffOrigin[];
    origins: readonly (DealOrigin | undefined)[];
  }>();
  const measuring = Boolean(dealing && handoff && measured?.handoff !== handoff);
  useStageFlip(stageRef, layoutKey, !reducedMotion && !measuring);

  useLayoutEffect(() => {
    if (!measuring || !handoff) return;
    // Cards render untransformed and hidden for this one layout pass so each
    // slot can be measured, then re-render before paint at their handoff pose.
    const origins = cards.map((card, index) => {
      const origin = handoff.find(({ positionId }) => positionId === card.positionId);
      const figure = figureRefs.current[index];
      if (!origin || !figure) return undefined;
      const slot = figure.getBoundingClientRect();
      if (slot.width === 0) return undefined;
      return {
        x: `${origin.centerX - (slot.left + slot.width / 2)}px`,
        y: `${origin.centerY - (slot.top + slot.height / 2)}px`,
        scale: origin.width / slot.width,
        opacity: 1,
      };
    });
    setMeasured({ handoff, origins });
  }, [cards, handoff, measuring]);

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
      data-settled-count={dealing ? settledCount : undefined}
      data-testid="tarot-spread-stage"
      ref={stageRef}
      style={layoutStyle}
    >
      {cards.map((card, index) => {
        const awaitingDeal = dealing && index >= settledCount;
        const dealOrigin = awaitingDeal
          ? (measured?.origins[index] ?? centeredDealOrigin(card))
          : undefined;
        return (
          <PhysicalTarotCard
            card={card}
            dealOrigin={dealOrigin}
            dealPose={measuring ? "measuring" : awaitingDeal ? "awaiting" : "settled"}
            figureRef={(node) => {
              figureRefs.current[index] = node;
            }}
            focusMode={activeIndex === index ? focusMode : null}
            index={index}
            key={`${card.positionId}-${card.cardId}`}
            narrationActive={narratingIndexes.includes(index)}
            onReveal={onReveal && !revealed.has(index) ? () => onReveal(index) : undefined}
            reducedMotion={reducedMotion}
            revealed={revealed.has(index)}
          />
        );
      })}
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
