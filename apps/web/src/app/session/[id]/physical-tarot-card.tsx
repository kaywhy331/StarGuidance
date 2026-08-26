"use client";

/* eslint-disable @next/next/no-img-element -- Authored AVIF/WebP/SVG art uses explicit picture sources. */
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import type { DealtCardView } from "./reading-types";

export function PhysicalTarotCard({
  card,
  focusMode,
  index,
  narrationActive = false,
  revealed,
  reducedMotion,
  onReveal,
}: {
  card: DealtCardView;
  focusMode: "reveal" | "reading" | null;
  index: number;
  narrationActive?: boolean;
  revealed: boolean;
  reducedMotion: boolean;
  /** Present only while this specific card is still face down and eligible for
   * intentional click/tap/keyboard reveal (PRD UX-006). Omitted once revealed. */
  onReveal?: (() => void) | undefined;
}) {
  const figureRef = useRef<HTMLElement>(null);
  // The element renders as a real <button> while it's an eligible reveal
  // target and a static <div role="img"> once revealed, so the ref has to
  // accept either concrete element; a callback ref keeps each branch's own
  // `ref` prop correctly typed to its own element instead of fighting
  // RefObject<T> variance.
  const cardRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const setCardRef = (node: HTMLButtonElement | HTMLDivElement | null) => {
    cardRef.current = node;
  };
  const focalStyle = {
    "--focal-x": `${card.artwork.focalPoint.x * 100}%`,
    "--focal-y": `${card.artwork.focalPoint.y * 100}%`,
    "--card-order": index,
    "--spread-column": card.placement.column + 1,
    "--spread-row": card.placement.row + 1,
    "--spread-rotation": `${card.placement.rotation}deg`,
    "--spread-layer": card.placement.layer,
    "--deal-origin-x": `${((card.spreadLayout.columns - 1) / 2 - card.placement.column) * 6.5}rem`,
    "--deal-origin-y": `${((card.spreadLayout.rows - 1) / 2 - card.placement.row) * 8.5}rem`,
  } as CSSProperties;

  useLayoutEffect(() => {
    const figureElement = figureRef.current;
    if (!figureElement) return;
    figureElement.classList.remove("is-cinematic-positioned");
    if (!focusMode) return;
    const cardElement = cardRef.current;
    if (!cardElement) return;
    const positionCard = () => {
      const bounds = cardElement.getBoundingClientRect();
      const stageBounds = figureElement.closest(".sanctuary-stage")?.getBoundingClientRect();
      const compact = window.innerWidth < 768;
      const readingFocus = focusMode === "reading";
      const availableHeight = stageBounds?.height ?? window.innerHeight;
      const targetWidth = readingFocus
        ? compact
          ? Math.min(window.innerWidth * 0.36, 9 * 16)
          : Math.min(window.innerWidth * 0.16, 10.5 * 16)
        : compact
          ? Math.min(window.innerWidth * 0.56, 13 * 16)
          : Math.min(window.innerWidth * 0.24, 18 * 16);
      // Reserve a stable band above for the card title and below for its
      // position description plus the reader-controlled Next card action.
      const targetHeight = availableHeight * (readingFocus ? 0.74 : 0.52);
      const scale = Math.max(
        readingFocus ? 0.75 : 1,
        Math.min(
          targetWidth / bounds.width,
          targetHeight / bounds.height,
          readingFocus ? 3.2 : 4.5,
        ),
      );
      const targetCenter = stageBounds
        ? {
            x: stageBounds.left + stageBounds.width / 2,
            y: stageBounds.top + stageBounds.height * (readingFocus ? 0.45 : 0.39),
          }
        : {
            x: window.innerWidth / 2,
            y: window.innerHeight * (readingFocus ? 0.25 : 0.4),
          };
      figureElement.style.setProperty(
        "--cinematic-x",
        `${targetCenter.x - (bounds.left + bounds.width / 2)}px`,
      );
      figureElement.style.setProperty(
        "--cinematic-y",
        `${targetCenter.y - (bounds.top + bounds.height / 2)}px`,
      );
      figureElement.style.setProperty("--cinematic-scale", String(scale));
    };
    positionCard();
    if (reducedMotion) {
      figureElement.classList.add("is-cinematic-positioned");
      return () => figureElement.classList.remove("is-cinematic-positioned");
    }
    // Commit the untransformed base style before applying the focus class.
    // A two-requestAnimationFrame handoff can be throttled for more than a
    // second in Firefox/WebKit under load, leaving most of the intentional
    // 2.2s reveal window at the small spread size. Forcing the base style here
    // starts the same CSS transition immediately and consistently.
    void window.getComputedStyle(figureElement).transform;
    figureElement.classList.add("is-cinematic-positioned");
    return () => {
      figureElement.classList.remove("is-cinematic-positioned");
    };
  }, [focusMode, reducedMotion]);

  const active = focusMode !== null;
  const revealable = !revealed && Boolean(onReveal);
  const cardClassName = `physical-tarot-card ${revealed ? "is-revealed" : ""} ${
    revealable ? "is-revealable" : ""
  } ${reducedMotion ? "motion-off" : ""}`;
  const inner = (
    <span className="physical-card-inner">
      <span className="physical-card-back" aria-hidden="true">
        <picture>
          {card.artwork.backAssetAvif && (
            <source srcSet={card.artwork.backAssetAvif} type="image/avif" />
          )}
          <img alt="" decoding="async" draggable={false} src={card.artwork.backAsset} />
        </picture>
        <span className="card-sheen" />
      </span>
      {revealed && (
        <span className="physical-card-front">
          <img
            alt={card.artwork.altText}
            className={card.orientation === "reversed" ? "card-art-reversed" : ""}
            decoding="async"
            draggable={false}
            src={card.artwork.frontAsset}
          />
          <span className="card-sheen" aria-hidden="true" />
        </span>
      )}
    </span>
  );

  return (
    <figure
      className={`physical-card-figure ${active ? "is-cinematic-subject" : ""} ${
        focusMode === "reading" ? "is-reading-subject" : ""
      } ${narrationActive ? "is-narration-active" : ""}`}
      data-spread-column={card.placement.column}
      data-spread-row={card.placement.row}
      data-spread-rotation={card.placement.rotation}
      ref={figureRef}
      style={focalStyle}
    >
      {revealable ? (
        <button
          aria-describedby={`card-position-${index}`}
          aria-label={`Reveal card ${index + 1}, face down`}
          className={cardClassName}
          onClick={onReveal}
          ref={setCardRef}
          type="button"
        >
          {inner}
        </button>
      ) : (
        <div
          aria-describedby={`card-position-${index}`}
          aria-label={
            revealed ? `${card.name}, ${card.orientation}` : `Card ${index + 1}, face down`
          }
          className={cardClassName}
          {...(revealed
            ? { "data-card-id": card.cardId, "data-orientation": card.orientation }
            : {})}
          ref={setCardRef}
          role="img"
        >
          {inner}
        </div>
      )}
      <figcaption className="sr-only" id={`card-position-${index}`}>
        {card.positionName}.{" "}
        {revealed
          ? `${card.name}${card.orientation === "reversed" ? ", reversed" : ""}.`
          : "Face down."}
      </figcaption>
    </figure>
  );
}
