"use client";

/* eslint-disable @next/next/no-img-element -- Authored AVIF/WebP/SVG art uses explicit picture sources. */
import { useLayoutEffect, useRef, type CSSProperties } from "react";

import type { DealtCardView } from "./reading-types";

export function PhysicalTarotCard({
  card,
  focusMode,
  index,
  revealed,
  reducedMotion,
  onReveal,
}: {
  card: DealtCardView;
  focusMode: "reveal" | "reading" | null;
  index: number;
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
  } as CSSProperties;

  useLayoutEffect(() => {
    const figureElement = figureRef.current;
    if (!figureElement) return;
    figureElement.classList.remove("is-cinematic-positioned");
    if (!focusMode) return;
    const cardElement = cardRef.current;
    if (!cardElement) return;
    const bounds = cardElement.getBoundingClientRect();
    const compact = window.innerWidth < 768;
    const readingFocus = focusMode === "reading";
    const targetWidth = readingFocus
      ? compact
        ? Math.min(window.innerWidth * 0.34, 9 * 16)
        : Math.min(window.innerWidth * 0.15, 10.5 * 16)
      : compact
        ? window.innerWidth * 0.7
        : window.innerWidth * 0.34;
    const targetHeight = window.innerHeight * (readingFocus ? (compact ? 0.32 : 0.26) : 0.68);
    const scale = Math.max(
      readingFocus ? 0.75 : 1,
      Math.min(targetWidth / bounds.width, targetHeight / bounds.height, readingFocus ? 3 : 3.8),
    );
    const targetCenter = readingFocus
      ? {
          x: window.innerWidth / 2,
          y: window.innerHeight * 0.25,
        }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    figureElement.style.setProperty(
      "--cinematic-x",
      `${targetCenter.x - (bounds.left + bounds.width / 2)}px`,
    );
    figureElement.style.setProperty(
      "--cinematic-y",
      `${targetCenter.y - (bounds.top + bounds.height / 2)}px`,
    );
    figureElement.style.setProperty("--cinematic-scale", String(scale));
    if (reducedMotion) {
      figureElement.classList.add("is-cinematic-positioned");
      return () => figureElement.classList.remove("is-cinematic-positioned");
    }
    let positionFrame = 0;
    const measurementFrame = window.requestAnimationFrame(() => {
      positionFrame = window.requestAnimationFrame(() =>
        figureElement.classList.add("is-cinematic-positioned"),
      );
    });
    return () => {
      window.cancelAnimationFrame(measurementFrame);
      window.cancelAnimationFrame(positionFrame);
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
      <span aria-hidden={!revealed} className="physical-card-front">
        <img
          alt={revealed ? card.artwork.altText : ""}
          className={card.orientation === "reversed" ? "card-art-reversed" : ""}
          decoding="async"
          draggable={false}
          src={card.artwork.frontAsset}
        />
        <span className="card-sheen" aria-hidden="true" />
      </span>
    </span>
  );

  return (
    <figure
      className={`physical-card-figure ${active ? "is-cinematic-subject" : ""} ${
        focusMode === "reading" ? "is-reading-subject" : ""
      }`}
      ref={figureRef}
      style={focalStyle}
    >
      {revealable ? (
        <button
          aria-describedby={`card-position-${index}`}
          aria-label={`Reveal card ${index + 1}, face down`}
          className={cardClassName}
          data-card-id={card.cardId}
          data-orientation={card.orientation}
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
          data-card-id={card.cardId}
          data-orientation={card.orientation}
          ref={setCardRef}
          role="img"
        >
          {inner}
        </div>
      )}
      <figcaption className="physical-card-caption" id={`card-position-${index}`}>
        <span>{card.positionName}</span>
        {revealed && (
          <>
            <small>
              {card.name}
              {card.orientation === "reversed" ? " · reversed" : ""}
            </small>
            <em>{card.themes.join(" · ")}</em>
          </>
        )}
      </figcaption>
    </figure>
  );
}
