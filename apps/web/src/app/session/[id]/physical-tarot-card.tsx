/* eslint-disable @next/next/no-img-element -- Authored AVIF/WebP/SVG art uses explicit picture sources. */
import type { CSSProperties } from "react";

import type { DealtCardView } from "./reading-types";

export function PhysicalTarotCard({
  card,
  index,
  revealed,
  reducedMotion,
  onReveal,
}: {
  card: DealtCardView;
  index: number;
  revealed: boolean;
  reducedMotion: boolean;
  onReveal: () => void;
}) {
  const focalStyle = {
    "--focal-x": `${card.artwork.focalPoint.x * 100}%`,
    "--focal-y": `${card.artwork.focalPoint.y * 100}%`,
    "--card-order": index,
  } as CSSProperties;
  return (
    <figure className="physical-card-figure" style={focalStyle}>
      <button
        aria-describedby={`card-position-${index}`}
        aria-label={revealed ? `${card.name}, ${card.orientation}` : `Reveal card ${index + 1}`}
        aria-pressed={revealed}
        className={`physical-tarot-card ${revealed ? "is-revealed" : ""} ${reducedMotion ? "motion-off" : ""}`}
        data-card-id={card.cardId}
        data-orientation={card.orientation}
        onClick={onReveal}
        type="button"
      >
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
      </button>
      <figcaption className="physical-card-caption" id={`card-position-${index}`}>
        <span>{card.positionName}</span>
        {revealed && (
          <small>
            {card.name}
            {card.orientation === "reversed" ? " · reversed" : ""}
          </small>
        )}
      </figcaption>
    </figure>
  );
}
